/**
 * RFC 9457 problem responses (R3.1, A5 section 3, A9 section 3). Every error the api answers is an
 * application/problem+json body built here, so a client parses one shape for every failure.
 *
 * Mechanism: handlers and hooks throw ProblemError with a status and a slug; the error handler
 * that app.ts installs (problemErrorHandler) turns it into the body. Errors that are not a
 * ProblemError are classified by what Fastify and the Zod type provider attach to them: request
 * validation failures become 400 with an errors list, Fastify's own 4xx errors (malformed JSON,
 * an oversized body, an unsupported media type, the rate limiter) keep their status, and
 * everything else becomes a generic 500 whose body says nothing about the cause. The cause goes
 * to the log only, so a stack trace, SQL text or an internal identifier never reaches the
 * client (A9 section 3).
 *
 * Bounds (PR #30 review MEDIUM 1, field-error-cap.ts): buildProblem keeps at most
 * MAX_PROBLEM_ERRORS field errors and puts the count of the rest in errors_omitted, and a
 * validation issue about unknown keys names the object and the count, never the key text, so no
 * request can make a problem large or make it echo what was sent.
 *
 * Extensions (RFC 9457 section 3.2): a ProblemError may carry extension members (numbers only),
 * such as the no-coverage problem's pairs_total and pairs_queued. They are written before the
 * standard members, so an extension can never replace type, status or errors. A route that
 * answers one declares it on that status's response schema; the shared Problem schema stays as it
 * was, so every other route's contract is unchanged.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { z } from "zod";

import { capErrors, MAX_PROBLEM_ERRORS, safeIssueMessage } from "./field-error-cap.js";
import { RETRY_AFTER_HEADER } from "./headers.js";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** The HTTP statuses the api answers, named once for every handler, hook and plugin. */
export const HTTP_STATUS = {
  ok: 200,
  created: 201,
  accepted: 202,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  gone: 410,
  unprocessable: 422,
  tooManyRequests: 429,
  internal: 500,
  notImplemented: 501,
  badGateway: 502,
  unavailable: 503,
} as const;

/** Postgres SQLSTATE codes the api turns into problems instead of 500s. */
export const PG_ERROR = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
} as const;

/** The SQLSTATE of a pg driver error, or undefined for anything else. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/** Problem type identifiers are URNs under one namespace, so they are stable and never fetched. */
const PROBLEM_TYPE_PREFIX = "urn:g-tee-oh:problem:";

export const PROBLEM_SLUGS = {
  badRequest: "bad-request",
  validation: "validation",
  unauthenticated: "unauthenticated",
  csrf: "csrf",
  forbiddenOrigin: "forbidden-origin",
  notFound: "not-found",
  methodNotAllowed: "method-not-allowed",
  conflict: "conflict",
  idempotencyInFlight: "idempotency-in-flight",
  idempotencyMismatch: "idempotency-mismatch",
  payloadTooLarge: "payload-too-large",
  unsupportedMediaType: "unsupported-media-type",
  rateLimited: "rate-limited",
  internal: "internal",
  notImplemented: "not-implemented",
  unavailable: "unavailable",
  // S23: the api trainer's problems.
  forbidden: "forbidden",
  upstream: "upstream",
  staleState: "stale-state",
  sessionEnded: "session-ended",
  noCoverage: "no-coverage",
  tooManyStreams: "too-many-streams",
  // S31: holdout sessions (R4.13, O-276).
  noHoldoutItems: "no-holdout-items",
  holdoutComplete: "holdout-complete",
  // S27: practice sessions and the Ask path (O-302, O-307).
  wrongSessionMode: "wrong-session-mode",
  askDisabled: "ask-disabled",
  askCapReached: "ask-cap-reached",
  // S42: invite links (O-422).
  inviteInvalid: "invite-invalid",
} as const;

export type ProblemSlug = (typeof PROBLEM_SLUGS)[keyof typeof PROBLEM_SLUGS];

const TITLES: Readonly<Record<ProblemSlug, string>> = {
  "bad-request": "Bad request",
  validation: "Request validation failed",
  unauthenticated: "Authentication required",
  csrf: "Cross-site request forgery check failed",
  "forbidden-origin": "Request origin not allowed",
  "not-found": "Not found",
  "method-not-allowed": "Method not allowed",
  conflict: "Conflict",
  "idempotency-in-flight": "A request with this Idempotency-Key is still being processed",
  "idempotency-mismatch": "Idempotency-Key reused with a different request",
  "payload-too-large": "Request body too large",
  "unsupported-media-type": "Unsupported media type",
  "rate-limited": "Too many requests",
  internal: "Internal server error",
  "not-implemented": "Not implemented",
  unavailable: "Service unavailable",
  forbidden: "Forbidden",
  upstream: "The solver-query service failed",
  "stale-state": "The session moved on since this prompt",
  "session-ended": "The session has ended",
  "no-coverage": "The library covers no spot this request selects",
  "too-many-streams": "Too many open event streams",
  "no-holdout-items": "No holdout items are drawn for this scope yet",
  "holdout-complete": "Every holdout item of this round is answered",
  "wrong-session-mode": "This route does not serve this session's mode",
  "ask-disabled": "Ask is off until a model key is configured",
  "ask-cap-reached": "This month's Ask budget is used",
  "invite-invalid": "This invite link is not valid",
};

/** The status Fastify-originated 4xx errors map to, by slug. */
const SLUG_BY_CLIENT_STATUS: Readonly<Record<number, ProblemSlug>> = {
  400: PROBLEM_SLUGS.badRequest,
  401: PROBLEM_SLUGS.unauthenticated,
  404: PROBLEM_SLUGS.notFound,
  405: PROBLEM_SLUGS.methodNotAllowed,
  409: PROBLEM_SLUGS.conflict,
  413: PROBLEM_SLUGS.payloadTooLarge,
  415: PROBLEM_SLUGS.unsupportedMediaType,
  429: PROBLEM_SLUGS.rateLimited,
};

const GENERIC_INTERNAL_DETAIL = "The server could not complete the request.";

export const problemFieldErrorSchema = z.object({
  path: z.string().describe("Dotted path of the offending field, prefixed by its location"),
  message: z.string(),
});

export const problemSchema = z
  .object({
    type: z.string().describe("A URN naming the problem, urn:g-tee-oh:problem:<slug>"),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional().describe("The request path"),
    request_id: z.string().optional().describe("The x-request-id of the failed request"),
    errors: z
      .array(problemFieldErrorSchema)
      .max(MAX_PROBLEM_ERRORS)
      .optional()
      .describe(`Field errors of a validation problem; at most ${MAX_PROBLEM_ERRORS}`),
    errors_omitted: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(`How many field errors were left out of errors, which lists at most ${MAX_PROBLEM_ERRORS}; absent when none were`),
  })
  .meta({ id: "Problem", description: "RFC 9457 problem details (application/problem+json)" });

export type Problem = z.infer<typeof problemSchema>;
export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;

export function problemType(slug: ProblemSlug): string {
  return `${PROBLEM_TYPE_PREFIX}${slug}`;
}

/** RFC 9457 extension members of one problem: named numbers, declared by the route that answers them. */
export type ProblemExtensions = Readonly<Record<string, number>>;

export interface ProblemErrorOptions {
  detail?: string;
  errors?: readonly ProblemFieldError[];
  /** Errors a caller already left out before passing errors (the export code decoder caps its own). */
  errorsOmitted?: number;
  /** Extension members written next to the standard ones; they never replace a standard member. */
  extensions?: ProblemExtensions;
  /** Extra response headers, such as Retry-After. */
  headers?: Readonly<Record<string, string>>;
}

/** The error every handler and hook throws for an expected failure. */
export class ProblemError extends Error {
  readonly status: number;
  readonly slug: ProblemSlug;
  readonly detail: string | undefined;
  readonly errors: readonly ProblemFieldError[] | undefined;
  readonly errorsOmitted: number;
  readonly extensions: ProblemExtensions;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, slug: ProblemSlug, options: ProblemErrorOptions = {}) {
    super(options.detail ?? TITLES[slug]);
    this.name = "ProblemError";
    this.status = status;
    this.slug = slug;
    this.detail = options.detail;
    this.errors = options.errors;
    this.errorsOmitted = options.errorsOmitted ?? 0;
    this.extensions = options.extensions ?? {};
    this.headers = options.headers ?? {};
  }
}

/** The errors member and, past the cap, errors_omitted (field-error-cap.ts). */
function cappedErrorMembers(
  errors: readonly ProblemFieldError[] | undefined,
  alreadyOmitted = 0,
): Pick<Problem, "errors" | "errors_omitted"> {
  if (errors === undefined) {
    return {};
  }
  const { kept, omitted } = capErrors(errors);
  const total = omitted + alreadyOmitted;
  return { errors: kept, ...(total === 0 ? {} : { errors_omitted: total }) };
}

export function buildProblem(
  status: number,
  slug: ProblemSlug,
  request: FastifyRequest,
  options: ProblemErrorOptions = {},
): Problem {
  return {
    ...options.extensions,
    type: problemType(slug),
    title: TITLES[slug],
    status,
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    instance: request.url.split("?")[0] ?? request.url,
    request_id: request.id,
    ...cappedErrorMembers(options.errors, options.errorsOmitted),
  };
}

export function sendProblem(reply: FastifyReply, problem: Problem, headers: Readonly<Record<string, string>> = {}) {
  return reply.code(problem.status).headers(headers).type(PROBLEM_CONTENT_TYPE).send(problem);
}

function validationErrors(error: unknown): ProblemFieldError[] | undefined {
  if (!hasZodFastifySchemaValidationErrors(error)) {
    return undefined;
  }
  const context = (error as { validationContext?: string }).validationContext ?? "request";
  return error.validation.map((issue) => {
    const pointer = issue.instancePath.replace(/^\//, "").replaceAll("/", ".");
    const keys = (issue.params as { keys?: unknown } | undefined)?.keys;
    return {
      path: pointer === "" ? context : `${context}.${pointer}`,
      message: safeIssueMessage(issue.keyword, issue.message ?? "invalid", keys),
    };
  });
}

function isClientStatus(status: unknown): status is number {
  return typeof status === "number" && status >= 400 && status < 500;
}

/** Fastify error handler: every thrown error leaves as a problem response. */
export function problemErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ProblemError) {
    if (error.status >= 500) {
      request.log.error({ err: error }, "request failed");
    }
    const problem = buildProblem(error.status, error.slug, request, {
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      ...(error.errors === undefined ? {} : { errors: error.errors }),
      errorsOmitted: error.errorsOmitted,
      extensions: error.extensions,
    });
    return sendProblem(reply, problem, error.headers);
  }

  const fieldErrors = validationErrors(error);
  if (fieldErrors !== undefined) {
    return sendProblem(reply, buildProblem(400, PROBLEM_SLUGS.validation, request, { errors: fieldErrors }));
  }

  if (isClientStatus(error.statusCode)) {
    const slug = SLUG_BY_CLIENT_STATUS[error.statusCode] ?? PROBLEM_SLUGS.badRequest;
    const headers = retryAfterHeader(reply);
    return sendProblem(reply, buildProblem(error.statusCode, slug, request, { detail: error.message }), headers);
  }

  request.log.error({ err: error }, "unhandled error");
  return sendProblem(
    reply,
    buildProblem(500, PROBLEM_SLUGS.internal, request, { detail: GENERIC_INTERNAL_DETAIL }),
  );
}

/** Keeps a Retry-After header an upstream hook (the rate limiter) already set on the reply. */
function retryAfterHeader(reply: FastifyReply): Record<string, string> {
  const value = reply.getHeader(RETRY_AFTER_HEADER);
  return value === undefined ? {} : { [RETRY_AFTER_HEADER]: String(value) };
}

/** Fastify not-found handler: unknown routes answer a 404 problem. */
export function problemNotFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return sendProblem(reply, buildProblem(404, PROBLEM_SLUGS.notFound, request));
}

/** Response schema entries for the given statuses, all application/problem+json. */
export function problemResponses<const Codes extends readonly number[]>(codes: Codes) {
  const entries = codes.map((code) => [
    code,
    { description: `Problem (${code})`, content: { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } } },
  ]);
  return Object.fromEntries(entries) as Record<
    Codes[number],
    { description: string; content: Record<typeof PROBLEM_CONTENT_TYPE, { schema: typeof problemSchema }> }
  >;
}
