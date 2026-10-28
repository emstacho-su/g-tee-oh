/**
 * Mocked prediction routes for the shots and mock projects (S27 lane A, R3.16, O-264, O-302): GET
 * /drills (the picker's list), POST /sessions for mode prediction, GET /prediction/{session}/next
 * and POST /prediction/{session}/answer over the contract-typed fixtures in
 * src/fixtures/prediction.ts.
 *
 * Mechanism: createMockPredictionRoute returns a pure route with its own in-memory state: the
 * prediction sessions it started, each with its state version, its answered counter and its
 * Idempotency-Key replies. POST /sessions with another mode returns undefined, so the session
 * route (mock-sessions.ts, listed after this one in mock-app.ts) answers it. Every route answers
 * 401 when signed out and the POSTs 403 csrf unless x-csrf-token is the fixture token, as the api
 * does (O-230). GET next is pure: prompt n is the fixture prompt n modulo six (range and hand
 * ladders alternating through levels 1 to 3) with the session's id, version and a prompt id of
 * its own. An answer must carry the current prompt id and state version (409 stale-state
 * otherwise) and the prompt's answer kind (400 otherwise); it is judged against the fixture truth,
 * advances the counter and the version, and a repeat with the same Idempotency-Key replays the
 * first reply (O-232). A right answer to the range level 1 prompt unlocks level 2.
 */
import type { PracticeSession, PredictionPrompt } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_PREDICTION_DRILL_ID,
  fixtureDrillList,
  fixturePredictionResult,
  fixturePredictions,
  fixturePredictionSession,
  type FixturePrediction,
} from "../../src/fixtures/prediction.js";
import type { PredictionAnswer } from "../../src/prediction/types.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

const STATUS = { ok: 200, created: 201 } as const;
const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  stale: { status: 409, slug: "stale-state", title: "Stale state" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

const DRILLS_PATH = "/api/v1/drills";
const SESSIONS_PATH = "/api/v1/sessions";
const PREDICTION_PATH = /^\/api\/v1\/prediction\/([^/]+)\/(next|answer)$/;
const PREDICTION_MODE = "prediction";
const SEED_PATTERN = /^[0-9a-f]{16}$/;
const IDEMPOTENCY_HEADER = "idempotency-key";
const ID_PREFIX = "00000000-0000-4000-8000-";
const PROMPT_ID_PREFIX = "00000000-0000-8000-8000-";
const ID_DIGITS = 12;
const FIRST_SESSION_NUMBER = 0x160;
const ANSWER_KEYS: Readonly<Record<string, readonly string[]>> = {
  yes_no: ["kind", "value"],
  percent: ["kind", "value"],
  regions: ["kind", "value"],
  action: ["kind", "action_index"],
  size: ["kind", "action_index"],
  band: ["kind", "band"],
};

interface MockPredictionSession {
  readonly id: string;
  readonly version: number;
  readonly counter: number;
  readonly replies: ReadonlyMap<string, MockResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function padded(prefix: string, number: number): string {
  return `${prefix}${number.toString(16).padStart(ID_DIGITS, "0")}`;
}

function entryAt(session: MockPredictionSession): FixturePrediction {
  const entry = fixturePredictions[session.counter % fixturePredictions.length];
  if (entry === undefined) throw new RangeError("the fixture has no prediction prompts");
  return entry;
}

/** The prompt a session shows now: the fixture's, with the session's id, version and own prompt id. */
function mockPromptOf(session: MockPredictionSession): PredictionPrompt {
  return { ...entryAt(session).prompt, session_id: session.id, state_version: session.version, prompt_id: padded(PROMPT_ID_PREFIX, session.counter) };
}

function hasCsrf(request: MockRequest): boolean {
  return request.headers[CSRF_HEADER] === FIXTURE_CSRF_TOKEN;
}

/** True when the body's answer has the prompt's kind and exactly that kind's fields with the right types. */
function isAnswerFor(prompt: PredictionPrompt, answer: unknown): answer is PredictionAnswer {
  if (!isRecord(answer) || answer["kind"] !== prompt.answer_kind) return false;
  const keys = ANSWER_KEYS[prompt.answer_kind] ?? [];
  if (Object.keys(answer).length !== keys.length || !keys.every((key) => key in answer)) return false;
  const value = answer["value"];
  switch (prompt.answer_kind) {
    case "yes_no":
      return typeof value === "boolean";
    case "percent":
      return typeof value === "number" && value >= 0 && value <= 100;
    case "regions":
      return Array.isArray(value) && value.every((region) => (prompt.regions ?? []).includes(region as never));
    case "action":
    case "size":
      return prompt.actions.some((action) => action.index === answer["action_index"]);
    case "band":
      return (prompt.bands ?? []).includes(answer["band"] as never);
  }
}

function startProblem(body: Record<string, unknown>): ProblemSpec | null {
  const seed = body["seed"];
  if (typeof body["drill_id"] !== "string" || (seed !== undefined && (typeof seed !== "string" || !SEED_PATTERN.test(seed)))) return PROBLEMS.validation;
  return body["drill_id"] === FIXTURE_PREDICTION_DRILL_ID ? null : PROBLEMS.notFound;
}

/** A fresh set of prediction routes with their own state. */
export function createMockPredictionRoute(): MockRoute {
  let sessions: ReadonlyMap<string, MockPredictionSession> = new Map();
  let started = 0;

  function save(session: MockPredictionSession): void {
    sessions = new Map([...sessions, [session.id, session]]);
  }

  function start(request: MockRequest, body: Record<string, unknown>): MockResponse {
    if (!hasCsrf(request)) return problem(PROBLEMS.csrf, request.path);
    const failure = startProblem(body);
    if (failure !== null) return problem(failure, request.path);
    const session: MockPredictionSession = { id: padded(ID_PREFIX, FIRST_SESSION_NUMBER + started), version: 0, counter: 0, replies: new Map() };
    started += 1;
    save(session);
    const reply: PracticeSession = { ...fixturePredictionSession, session_id: session.id, state_version: session.version };
    return json(STATUS.created, reply);
  }

  function answer(session: MockPredictionSession, request: MockRequest): MockResponse {
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replay = key === undefined ? undefined : session.replies.get(key);
    if (replay !== undefined) return replay;
    const body = request.body;
    const prompt = mockPromptOf(session);
    if (!isRecord(body) || typeof body["prompt_id"] !== "string" || typeof body["state_version"] !== "number") return problem(PROBLEMS.validation, request.path);
    if (body["state_version"] !== session.version || body["prompt_id"] !== prompt.prompt_id) return problem(PROBLEMS.stale, request.path);
    if (!isAnswerFor(prompt, body["answer"])) return problem(PROBLEMS.validation, request.path);
    const result = { ...fixturePredictionResult(entryAt(session), body["answer"], session.version), prompt_id: prompt.prompt_id };
    const response = json(STATUS.ok, result);
    save({
      ...session,
      version: result.state_version,
      counter: session.counter + 1,
      replies: key === undefined ? session.replies : new Map([...session.replies, [key, response]]),
    });
    return response;
  }

  function predictionRoute(request: MockRequest, id: string, action: string): MockResponse | undefined {
    const method = request.method.toUpperCase();
    const reading = method === "GET" && action === "next";
    const writing = method === "POST" && action === "answer";
    if (!reading && !writing) return undefined;
    if (writing && !hasCsrf(request)) return problem(PROBLEMS.csrf, request.path);
    const session = sessions.get(id);
    if (session === undefined) return problem(PROBLEMS.notFound, request.path);
    return reading ? json(STATUS.ok, mockPromptOf(session)) : answer(session, request);
  }

  return (request, { signedIn }) => {
    const method = request.method.toUpperCase();
    const prediction = PREDICTION_PATH.exec(request.path);
    const listing = request.path === DRILLS_PATH && method === "GET";
    const body = request.body;
    const starting = request.path === SESSIONS_PATH && method === "POST" && isRecord(body) && body["mode"] === PREDICTION_MODE;
    if (!listing && !starting && prediction === null) return undefined;
    if (!signedIn) return problem(UNAUTHENTICATED, request.path);
    if (listing) return json(STATUS.ok, fixtureDrillList);
    if (starting && isRecord(body)) return start(request, body);
    return predictionRoute(request, prediction?.[1] ?? "", prediction?.[2] ?? "");
  };
}
