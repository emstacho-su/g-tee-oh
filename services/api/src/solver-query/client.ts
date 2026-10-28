/**
 * The api's solver-query client (R3.3, R3.7, A5 sections 1 and 2, ADR 0004, O-53, O-158).
 *
 * Every poker number the api shows or stores comes from solver-query, so the api never computes
 * one (ADR 0004). buildApp decorates the app with one typed openapi-fetch client (the committed
 * solver-query contract, O-38), or null when it was built without one (the OpenAPI export and the
 * HTTP-layer unit tests); requireSolverQuery turns null into a 503 problem, as requireDatabase does.
 *
 * expectData unwraps one call. solver-query answers RFC 9457 problems; the api never relays their
 * bodies, only a status mapped to its own problem with a generic detail, so nothing the upstream
 * says reaches a browser verbatim:
 * - 400 is the request the api built from the caller's input, so it stays a 400;
 * - 404 is a solution, node or hand the library does not hold, so it stays a 404;
 * - 503 is a solution the library marked unavailable, so it stays a 503;
 * - anything else, including a network failure or a body that is not JSON, is a 502.
 * The caller's x-request-id travels with every call (upstreamHeaders, O-158), so one id names the
 * request in both services' logs.
 */
import "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { createSolverQueryClient, type SolverQueryComponents } from "@g-tee-oh/contracts";
import { z } from "zod";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";

/** The typed openapi-fetch client over the committed solver-query contract. */
export type SolverQuery = ReturnType<typeof createSolverQueryClient>;
export type SqSchemas = SolverQueryComponents["schemas"];
export type SqNode = SqSchemas["NodeResponse"];
export type SqAction = SqSchemas["ActionView"];
export type SqGrade = SqSchemas["GradeResponse"];
export type SqCoverage = SqSchemas["CoverageResponse"];
/** One spot class of a (configuration, pair) from GET /v1/coverage?classes=true (S31, O-270). */
export type SqSpotClassEntry = SqSchemas["SpotClassEntry"];
/** One decision node of a spot class, with its line, hero seat, pot, line reach and history (O-270). */
export type SqClassSpot = SqSchemas["ClassSpot"];
export type SqClassHistoryEntry = SqSchemas["ClassHistoryEntry"];
export type SqInsights = SqSchemas["InsightsResponse"];
export type SqDeal = SqSchemas["DealResponse"];
export type SqReveal = SqSchemas["RevealResponse"];
export type SqSampleAction = SqSchemas["SampleActionResponse"];

declare module "fastify" {
  interface FastifyInstance {
    solverQuery: SolverQuery | null;
  }
}

export const REQUEST_ID_HEADER = "x-request-id";

/** PR #25 security review M1: no solver-query call may hold a request open longer than this. */
export const DEFAULT_SOLVER_QUERY_TIMEOUT_MS = 5000;

export interface SolverQueryOptions {
  /** Lets a test answer, count or delay calls without a socket. */
  fetch?: typeof fetch;
  /** Abort a call after this many milliseconds; the abort maps to the generic 502 (expectData). */
  timeoutMs?: number;
}

/** `fetchImpl` with every call aborted after `timeoutMs`, keeping any signal the caller gave. */
export function withTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return (input, init) => {
    const given = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = given === undefined || given === null ? timeout : AbortSignal.any([given, timeout]);
    return fetchImpl(input, { ...init, signal });
  };
}

export function createSolverQuery(baseUrl: string, options: SolverQueryOptions = {}): SolverQuery {
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_SOLVER_QUERY_TIMEOUT_MS;
  return createSolverQueryClient(baseUrl, { fetch: withTimeout(fetchImpl, timeoutMs) });
}

export function requireSolverQuery(app: FastifyInstance): SolverQuery {
  if (app.solverQuery === null) {
    throw new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, {
      detail: "The solver-query service is not configured.",
    });
  }
  return app.solverQuery;
}

/** The headers every solver-query call carries: the request id of the api request (O-158). */
export function upstreamHeaders(request: FastifyRequest): Record<string, string> {
  return { [REQUEST_ID_HEADER]: request.id };
}

/** What an openapi-fetch call resolves to, narrowed to what expectData reads. */
export interface UpstreamResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function upstreamProblem(status: number, what: string): ProblemError {
  if (status === HTTP_STATUS.badRequest) {
    return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
      detail: `The library could not read ${what} as requested.`,
    });
  }
  if (status === HTTP_STATUS.notFound) {
    return new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, {
      detail: `The library holds no ${what}.`,
    });
  }
  if (status === HTTP_STATUS.unavailable) {
    return new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, {
      detail: `The library marks ${what} unavailable.`,
    });
  }
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, {
    detail: `solver-query could not answer for ${what}.`,
  });
}

const upstreamProblemTypeSchema = z.object({ type: z.string() });
const UPSTREAM_PROBLEM_TYPE_SEPARATOR = ":";

/**
 * The tag of a solver-query problem body (the last part of its urn:g-tee-oh:problem:<tag> type), or
 * undefined when the body is not a problem with a type (a proxy's 503, for example).
 */
export function upstreamProblemTag(body: unknown): string | undefined {
  const parsed = upstreamProblemTypeSchema.safeParse(body);
  return parsed.success ? parsed.data.type.split(UPSTREAM_PROBLEM_TYPE_SEPARATOR).at(-1) : undefined;
}

/**
 * Awaits one solver-query call and returns its body, or throws the api problem its status maps
 * to. `what` names the thing asked for in the detail, for example "this node".
 */
export async function expectData<T>(call: Promise<UpstreamResult<T>>, what: string): Promise<T> {
  let result: UpstreamResult<T>;
  try {
    result = await call;
  } catch (cause: unknown) {
    throw Object.assign(upstreamProblem(HTTP_STATUS.badGateway, what), { cause });
  }
  if (result.response.ok && result.data !== undefined) {
    return result.data;
  }
  throw upstreamProblem(result.response.status, what);
}
