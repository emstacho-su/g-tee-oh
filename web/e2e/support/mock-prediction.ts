/**
 * Mocked quiz routes for the shots and mock projects (S27 lane A, S41, R3.16, O-264, O-302, O-410,
 * O-412, O-414, O-415): GET /drills, POST /sessions for mode prediction (an old drill start or a
 * catalog-spot quiz), GET /prediction/{session}/next, POST /prediction/{session}/answer and POST
 * /sessions/{id}/end for its own sessions, over the contract-typed fixtures in
 * src/fixtures/prediction.ts.
 *
 * Mechanism: createMockPredictionRoute returns a pure route with its own in-memory state: the
 * prediction sessions it started, each with the prompts it walks (mock-quiz.ts startEntries: every
 * fixture prompt for a drill start, the chosen difficulty's prompts on the chosen ladders for a
 * quiz), its state version, its answered counter, whether it ended and its Idempotency-Key replies.
 * POST /sessions with another mode, and the end of a session it did not start, return undefined, so
 * the session route (mock-sessions.ts, listed after this one in mock-app.ts) answers them. Every
 * route answers 401 when signed out and the POSTs 403 csrf unless x-csrf-token is the fixture
 * token, as the api does (O-230). GET next is pure: prompt n is the session's prompt n modulo its
 * list, with the session's id, version and a prompt id of its own. An answer must carry the current
 * prompt id and state version (409 stale-state otherwise), the prompt's answer kind (400 otherwise)
 * and a reason the api accepts (400 naming body.rationale, mock-quiz.ts rationaleProblem), all checked before anything is
 * recorded; it is judged against the fixture truth (the result carries level_passed), advances the
 * counter and the version, and a repeat with the same Idempotency-Key replays the first reply
 * (O-232). An ended session answers 409 session-ended to next and answer.
 */
import type { PracticeSession, PredictionPrompt } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { fixturePaintDrills } from "../../src/fixtures/paint.js";
import { fixtureDrillList, fixturePredictionResult, fixturePredictionSession, type FixturePrediction } from "../../src/fixtures/prediction.js";
import type { PredictionAnswer } from "../../src/prediction/types.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";
import { REASON_FIELD_ERRORS, SHORT_REASON_DETAIL, rationaleProblem, recapFor, startEntries } from "./mock-quiz.js";

const STATUS = { ok: 200, created: 201 } as const;
const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  stale: { status: 409, slug: "stale-state", title: "Stale state" },
  ended: { status: 409, slug: "session-ended", title: "Session ended" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

const DRILLS_PATH = "/api/v1/drills";
/**
 * The one drill list the composed app mock serves (this route answers GET /drills before the paint
 * route): every practice fixture drill once.
 */
export const PRACTICE_DRILL_LIST = {
  items: [...new Map([...fixtureDrillList.items, ...fixturePaintDrills].map((drill) => [drill.id, drill])).values()],
  next_cursor: null,
};
const SESSIONS_PATH = "/api/v1/sessions";
const PREDICTION_PATH = /^\/api\/v1\/prediction\/([^/]+)\/(next|answer)$/;
const END_PATH = /^\/api\/v1\/sessions\/([^/]+)\/end$/;
const PREDICTION_MODE = "prediction";
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
  readonly entries: readonly FixturePrediction[];
  readonly drillId: string | null;
  readonly version: number;
  readonly counter: number;
  readonly ended: boolean;
  readonly replies: ReadonlyMap<string, MockResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function padded(prefix: string, number: number): string {
  return `${prefix}${number.toString(16).padStart(ID_DIGITS, "0")}`;
}

function entryAt(session: MockPredictionSession): FixturePrediction {
  const entry = session.entries[session.counter % session.entries.length];
  if (entry === undefined) throw new RangeError("the session has no prediction prompts");
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

/** A refused reason: its problem names body.rationale, with the api's fixed detail on the short-reason one. */
function reasonRefusal(spec: ProblemSpec, path: string): MockResponse {
  const base = problem(spec, path);
  const detail = spec.slug === "bad-request" ? { detail: SHORT_REASON_DETAIL } : {};
  return { ...base, body: { ...(base.body as object), ...detail, errors: REASON_FIELD_ERRORS } };
}

interface AnswerRefusal {
  readonly spec: ProblemSpec;
  /** The reason is what was refused. */
  readonly reason: boolean;
}

/** The problem an answer body earns before anything is recorded, or null. */
function answerProblem(session: MockPredictionSession, body: unknown): AnswerRefusal | null {
  const prompt = mockPromptOf(session);
  if (!isRecord(body) || typeof body["prompt_id"] !== "string" || typeof body["state_version"] !== "number") return { spec: PROBLEMS.validation, reason: false };
  const reason = rationaleProblem(body["rationale"]);
  if (reason !== null) return { spec: reason, reason: true };
  if (body["state_version"] !== session.version || body["prompt_id"] !== prompt.prompt_id) return { spec: PROBLEMS.stale, reason: false };
  return isAnswerFor(prompt, body["answer"]) ? null : { spec: PROBLEMS.validation, reason: false };
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
    const entries = startEntries(body);
    if (!Array.isArray(entries)) return problem(entries as ProblemSpec, request.path);
    const drillId = typeof body["drill_id"] === "string" ? body["drill_id"] : null;
    const id = padded(ID_PREFIX, FIRST_SESSION_NUMBER + started);
    started += 1;
    save({ id, entries, drillId, version: 0, counter: 0, ended: false, replies: new Map() });
    const reply: PracticeSession = { ...fixturePredictionSession, session_id: id, drill_id: drillId, state_version: 0 };
    return json(STATUS.created, reply);
  }

  function answer(session: MockPredictionSession, request: MockRequest): MockResponse {
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replay = key === undefined ? undefined : session.replies.get(key);
    if (replay !== undefined) return replay;
    const refused = answerProblem(session, request.body);
    if (refused !== null) return refused.reason ? reasonRefusal(refused.spec, request.path) : problem(refused.spec, request.path);
    const body = request.body as { answer: PredictionAnswer };
    const prompt = mockPromptOf(session);
    const result = { ...fixturePredictionResult(entryAt(session), body.answer, session.version), prompt_id: prompt.prompt_id };
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
    if (session.ended) return problem(PROBLEMS.ended, request.path);
    return reading ? json(STATUS.ok, mockPromptOf(session)) : answer(session, request);
  }

  function end(request: MockRequest, session: MockPredictionSession): MockResponse {
    if (!hasCsrf(request)) return problem(PROBLEMS.csrf, request.path);
    save({ ...session, ended: true });
    return json(STATUS.ok, recapFor(session.id));
  }

  return (request, { signedIn }) => {
    const method = request.method.toUpperCase();
    const prediction = PREDICTION_PATH.exec(request.path);
    const ending = method === "POST" ? sessions.get(END_PATH.exec(request.path)?.[1] ?? "") : undefined;
    const listing = request.path === DRILLS_PATH && method === "GET";
    const body = request.body;
    const starting = request.path === SESSIONS_PATH && method === "POST" && isRecord(body) && body["mode"] === PREDICTION_MODE;
    if (!listing && !starting && prediction === null && ending === undefined) return undefined;
    if (!signedIn) return problem(UNAUTHENTICATED, request.path);
    if (listing) return json(STATUS.ok, PRACTICE_DRILL_LIST);
    if (ending !== undefined) return end(request, ending);
    if (starting && isRecord(body)) return start(request, body);
    return predictionRoute(request, prediction?.[1] ?? "", prediction?.[2] ?? "");
  };
}
