/**
 * Mocked S27 explain routes for the shots and mock projects (S27 lane D, R3.19, R3.20, O-264,
 * O-305 to O-308): GET /explain/status, GET /explain/{attempt_id}/more-info and POST
 * /explain/{attempt_id}/ask, answered from the contract-typed fixtures (src/fixtures/explain.ts).
 *
 * Mechanism: createMockExplainRoute returns a pure route with its own state, the way the api
 * behaves in the order it checks things: sign-in (401), CSRF on the POST (403), Idempotency-Key
 * replay, the body (a trimmed question of 1 to 500 characters, else 400), the flag (503
 * ask-disabled), the cache (the same normalized question on the same attempt again answers cached
 * true and costs nothing, even above the cap, O-306), then the cap (429 ask-cap-reached). The
 * status reason is "ok" unless the options set another, and a request carrying the
 * MOCK_ASK_STATUS_HEADER header (the shots set it with page.setExtraHTTPHeaders) switches it per
 * request, so one page can show flag_off, cap_reached and ok in turn. A question containing
 * MOCK_ASK_WARNING_TRIGGER gets the unvalidated answer with the api's warning (O-308); any other
 * question the validated one. Each fresh answer adds its cost to the status's spend.
 */
import type { AskResult, AskStatus } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  fixtureAskAnswerFor,
  fixtureAskStatusByReason,
  fixtureAskWarningFor,
  fixtureMoreInfoFor,
} from "../../src/fixtures/explain.js";
import { ASK_QUESTION_MAX_CHARS } from "../../src/explain/texts.js";
import { IDEMPOTENCY_HEADER } from "../../src/trainer/idempotency.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

type AskReason = AskStatus["reason"];

/** The request header a shot sets to switch the mocked Ask status (ok, flag_off, cap_reached). */
export const MOCK_ASK_STATUS_HEADER = "x-mock-ask-status";
/** A question containing this word gets the answer the validator could not check. */
export const MOCK_ASK_WARNING_TRIGGER = "unchecked";

export interface MockExplainOptions {
  /** The status reason when no header overrides it; "ok" by default. */
  readonly reason?: AskReason;
}

const STATUS_PATH = "/api/v1/explain/status";
const ATTEMPT_PATH = /^\/api\/v1\/explain\/([^/]+)\/(more-info|ask)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_OK = 200;
const REASONS: ReadonlySet<string> = new Set<AskReason>(["ok", "flag_off", "cap_reached"]);

const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  askDisabled: { status: 503, slug: "ask-disabled", title: "Ask is off until a model key is configured" },
  askCapReached: { status: 429, slug: "ask-cap-reached", title: "This month's Ask budget is used" },
} as const satisfies Record<string, ProblemSpec>;

function reasonOf(request: MockRequest, fallback: AskReason): AskReason {
  const header = request.headers[MOCK_ASK_STATUS_HEADER];
  return header !== undefined && REASONS.has(header) ? (header as AskReason) : fallback;
}

/** The trimmed question, or null when the body is not the contract's shape. */
function questionOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const question: unknown = (body as Record<string, unknown>)["question"];
  if (typeof question !== "string") return null;
  const trimmed = question.trim();
  return trimmed === "" || trimmed.length > ASK_QUESTION_MAX_CHARS ? null : trimmed;
}

/** The cache key: the attempt plus the question trimmed, whitespace collapsed and lower case. */
function cacheKeyOf(attemptId: string, question: string): string {
  return `${attemptId}\n${question.replace(/\s+/g, " ").toLowerCase()}`;
}

function freshAnswer(attemptId: string, question: string): AskResult {
  return question.toLowerCase().includes(MOCK_ASK_WARNING_TRIGGER) ? fixtureAskWarningFor(attemptId) : fixtureAskAnswerFor(attemptId);
}

/** A fresh set of explain routes with their own spend, cache and replies. */
export function createMockExplainRoute(options: MockExplainOptions = {}): MockRoute {
  const defaultReason = options.reason ?? "ok";
  let spentCents = 0;
  let cache: ReadonlyMap<string, AskResult> = new Map();
  let replies: ReadonlyMap<string, MockResponse> = new Map();

  function status(request: MockRequest): MockResponse {
    const base = fixtureAskStatusByReason[reasonOf(request, defaultReason)];
    return json(STATUS_OK, base.reason === "ok" ? { ...base, spent_cents: base.spent_cents + spentCents } : base);
  }

  function answer(request: MockRequest, attemptId: string): MockResponse {
    const question = questionOf(request.body);
    if (question === null) return problem(PROBLEMS.validation, request.path);
    const reason = reasonOf(request, defaultReason);
    if (reason === "flag_off") return problem(PROBLEMS.askDisabled, request.path);
    const key = cacheKeyOf(attemptId, question);
    const cached = cache.get(key);
    if (cached !== undefined) return json(STATUS_OK, { ...cached, cached: true, cost_cents: 0 });
    if (reason === "cap_reached") return problem(PROBLEMS.askCapReached, request.path);
    const result = freshAnswer(attemptId, question);
    spentCents += result.cost_cents;
    cache = new Map([...cache, [key, result]]);
    return json(STATUS_OK, result);
  }

  function ask(request: MockRequest, attemptId: string): MockResponse {
    if (request.headers[CSRF_HEADER] !== FIXTURE_CSRF_TOKEN) return problem(PROBLEMS.csrf, request.path);
    const idempotencyKey = request.headers[IDEMPOTENCY_HEADER];
    const replay = idempotencyKey === undefined ? undefined : replies.get(idempotencyKey);
    if (replay !== undefined) return replay;
    const response = answer(request, attemptId);
    if (idempotencyKey !== undefined) replies = new Map([...replies, [idempotencyKey, response]]);
    return response;
  }

  function attemptRoute(request: MockRequest, attemptId: string, action: string): MockResponse {
    if (!UUID_PATTERN.test(attemptId)) return problem(PROBLEMS.validation, request.path);
    return action === "ask" ? ask(request, attemptId) : json(STATUS_OK, fixtureMoreInfoFor(attemptId));
  }

  return (request, { signedIn }) => {
    const method = request.method.toUpperCase();
    const attempt = ATTEMPT_PATH.exec(request.path);
    const action = attempt?.[2];
    const ours =
      (request.path === STATUS_PATH && method === "GET") ||
      (action === "more-info" && method === "GET") ||
      (action === "ask" && method === "POST");
    if (!ours) return undefined;
    if (!signedIn) return problem(UNAUTHENTICATED, request.path);
    if (attempt === null) return status(request);
    return attemptRoute(request, attempt[1] ?? "", action ?? "");
  };
}
