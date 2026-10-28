/**
 * Mocked drill and session routes for the shots and mock projects (S25, R3.13, O-264): GET
 * /drills/{id}, POST /sessions, GET /sessions/{id}/next, POST /sessions/{id}/decisions and POST
 * /sessions/{id}/end over the synthetic fixtures in src/fixtures/trainer.ts.
 *
 * Mechanism: createMockSessionRoute returns a route with its own in-memory state: the sessions it
 * started, each with its RNG setting, the hand it is at (the fixture hands in a cycle), its state
 * version, the decisions graded so far, the Idempotency-Key replies and the recap once ended. Every
 * route answers 401 when signed out, and the three POSTs answer 403 csrf unless x-csrf-token equals
 * the fixture token, as the api does (O-230). POST /sessions takes mode drill with the fixture
 * drill (201), answers 422 no-coverage for the uncovered fixture drill (ADR 0018) and 400 for a bad
 * body or seed. GET /next is pure: the current hand's prompt, with the roll only in RNG mode
 * (O-282). A decision for an older state version is a 409 stale-state; a repeat with the same
 * Idempotency-Key replays the first answer (O-232); a correct one advances the hand and the
 * version. In RNG mode or not, choosing an action in best_action_indexes is labeled best. End
 * answers the recap of the decisions made and the session then refuses more with 409
 * session-ended. mockSessionRoute is one ready-made instance; mock-app.ts may build a fresh one
 * per mocked api with createMockSessionRoute.
 */
import type { DecisionFeedback, TrainerPrompt } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_DRILL_ID,
  FIXTURE_UNCOVERED_DRILL_ID,
  fixtureDrill,
  fixtureTrainerHands,
  type FixtureHand,
} from "../../src/fixtures/trainer.js";
import type { PracticeSession, SessionRecap } from "../../src/trainer/session-types.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

const STATUS = { ok: 200, created: 201 } as const;
const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  stale: { status: 409, slug: "stale-state", title: "Stale state" },
  ended: { status: 409, slug: "session-ended", title: "Session ended" },
  noCoverage: { status: 422, slug: "no-coverage", title: "No coverage" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

const DRILL_PATH = /^\/api\/v1\/drills\/([^/]+)$/;
const SESSIONS_PATH = "/api/v1/sessions";
const SESSION_PATH = /^\/api\/v1\/sessions\/([^/]+)\/(next|decisions|end)$/;
const SEED_PATTERN = /^[0-9a-f]{16}$/;
const IDEMPOTENCY_HEADER = "idempotency-key";
const SESSION_ID_PREFIX = "00000000-0000-4000-8000-";
const SESSION_ID_DIGITS = 12;
const FIRST_SESSION_NUMBER = 0x100;
const STARTED_AT = "2026-10-27T12:00:00Z";
const ENDED_AT = "2026-10-27T12:20:00Z";
const BEST_SCORE = 1;

interface Graded {
  readonly score: number;
  readonly evLossBb: number;
}

interface MockSession {
  readonly id: string;
  readonly rng: boolean;
  readonly hand: number;
  readonly version: number;
  readonly graded: readonly Graded[];
  readonly replies: ReadonlyMap<string, MockResponse>;
  readonly recap: SessionRecap | null;
}

interface DecisionBody {
  state_version: number;
  action_index: number;
  response_ms: number;
  confidence?: "sure" | "unsure";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isDecisionBody(body: unknown): body is DecisionBody {
  if (!isRecord(body)) return false;
  const confidence = body["confidence"];
  const confidenceOk = confidence === undefined || confidence === "sure" || confidence === "unsure";
  return isNonNegativeInteger(body["state_version"]) && isNonNegativeInteger(body["action_index"]) && isNonNegativeInteger(body["response_ms"]) && confidenceOk;
}

function handAt(session: MockSession): FixtureHand {
  const hand = fixtureTrainerHands[session.hand % fixtureTrainerHands.length];
  if (hand === undefined) throw new RangeError("the fixture session has no hands");
  return hand;
}

function promptOf(session: MockSession): TrainerPrompt {
  const hand = handAt(session);
  return { ...hand.prompt, session_id: session.id, state_version: session.version, rng_roll: session.rng ? hand.roll : null };
}

function feedbackOf(session: MockSession, actionIndex: number): DecisionFeedback {
  const hand = handAt(session);
  const best = hand.feedback.best_action_indexes.includes(actionIndex);
  const graded = best ? { label: "best" as const, score: BEST_SCORE, ev_loss_bb: 0, ev_loss_pct_pot: 0 } : {};
  return { ...hand.feedback, ...graded, state_version: session.version + 1, rng_roll: session.rng ? hand.roll : null };
}

function recapOf(session: MockSession): SessionRecap {
  const total = session.graded.reduce((sum, entry) => sum + entry.score, 0);
  return {
    session_id: session.id,
    ended_at: ENDED_AT,
    decisions: session.graded.length,
    rated_decisions: session.graded.length,
    mean_score: session.graded.length === 0 ? null : total / session.graded.length,
    ev_loss_bb_total: session.graded.reduce((sum, entry) => sum + entry.evLossBb, 0),
    rating_changes: [],
    tier: null,
    unlocks: [],
  };
}

function hasCsrf(request: MockRequest): boolean {
  return request.headers[CSRF_HEADER] === FIXTURE_CSRF_TOKEN;
}

function drillResponse(id: string, path: string): MockResponse {
  if (id === FIXTURE_DRILL_ID) return json(STATUS.ok, fixtureDrill);
  if (id === FIXTURE_UNCOVERED_DRILL_ID) return json(STATUS.ok, { ...fixtureDrill, id, name: "A drill the library does not cover" });
  return problem(PROBLEMS.notFound, path);
}

/** The problem a POST /sessions body earns, or null when it starts a session. */
function startProblem(body: unknown): ProblemSpec | null {
  if (!isRecord(body) || body["mode"] !== "drill" || typeof body["drill_id"] !== "string") return PROBLEMS.validation;
  const seed = body["seed"];
  if (seed !== undefined && (typeof seed !== "string" || !SEED_PATTERN.test(seed))) return PROBLEMS.validation;
  if (body["drill_id"] === FIXTURE_UNCOVERED_DRILL_ID) return PROBLEMS.noCoverage;
  if (body["drill_id"] !== FIXTURE_DRILL_ID) return PROBLEMS.notFound;
  return null;
}

function rngOf(body: unknown): boolean {
  const settings = isRecord(body) ? body["settings"] : undefined;
  const rng = isRecord(settings) ? settings["rng"] : undefined;
  return typeof rng === "boolean" ? rng : fixtureDrill.trainer.rng;
}

/** A fresh set of session routes with their own state. */
export function createMockSessionRoute(): MockRoute {
  let sessions: ReadonlyMap<string, MockSession> = new Map();
  let started = 0;

  function save(session: MockSession): void {
    sessions = new Map([...sessions, [session.id, session]]);
  }

  function startSession(request: MockRequest): MockResponse {
    const failure = startProblem(request.body);
    if (failure !== null) return problem(failure, request.path);
    const number = FIRST_SESSION_NUMBER + started;
    started += 1;
    const id = `${SESSION_ID_PREFIX}${number.toString(16).padStart(SESSION_ID_DIGITS, "0")}`;
    const session: MockSession = { id, rng: rngOf(request.body), hand: 0, version: 1, graded: [], replies: new Map(), recap: null };
    save(session);
    const body: PracticeSession = { session_id: id, mode: "drill", drill_id: FIXTURE_DRILL_ID, state: "await_hero", state_version: session.version, started_at: STARTED_AT, rated_eligible: false, automated: null, holdout: null };
    return json(STATUS.created, body);
  }

  function decide(session: MockSession, request: MockRequest): MockResponse {
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replay = key === undefined ? undefined : session.replies.get(key);
    if (replay !== undefined) return replay;
    if (!isDecisionBody(request.body)) return problem(PROBLEMS.validation, request.path);
    if (request.body.state_version !== session.version) return problem(PROBLEMS.stale, request.path);
    const actionIndex = request.body.action_index;
    if (!handAt(session).prompt.buttons.some((button) => button.index === actionIndex)) return problem(PROBLEMS.validation, request.path);
    const feedback = feedbackOf(session, actionIndex);
    const response = json(STATUS.ok, feedback);
    save({
      ...session,
      hand: session.hand + 1,
      version: feedback.state_version,
      graded: [...session.graded, { score: feedback.score, evLossBb: feedback.ev_loss_bb }],
      replies: key === undefined ? session.replies : new Map([...session.replies, [key, response]]),
    });
    return response;
  }

  function end(session: MockSession): MockResponse {
    const recap = session.recap ?? recapOf(session);
    save({ ...session, recap });
    return json(STATUS.ok, recap);
  }

  function sessionRoute(request: MockRequest, id: string, action: string): MockResponse | undefined {
    const method = request.method.toUpperCase();
    const reading = method === "GET" && action === "next";
    if (!reading && method !== "POST") return undefined;
    if (!reading && !hasCsrf(request)) return problem(PROBLEMS.csrf, request.path);
    const session = sessions.get(id);
    if (session === undefined) return problem(PROBLEMS.notFound, request.path);
    if (action === "end") return end(session);
    if (session.recap !== null) return problem(PROBLEMS.ended, request.path);
    return reading ? json(STATUS.ok, promptOf(session)) : decide(session, request);
  }

  return (request, { signedIn }) => {
    const method = request.method.toUpperCase();
    const drill = DRILL_PATH.exec(request.path);
    const sessionMatch = SESSION_PATH.exec(request.path);
    const ours = (drill !== null && method === "GET") || (request.path === SESSIONS_PATH && method === "POST") || sessionMatch !== null;
    if (!ours) return undefined;
    if (!signedIn) return problem(UNAUTHENTICATED, request.path);
    if (drill !== null) return drillResponse(drill[1] ?? "", request.path);
    if (sessionMatch !== null) return sessionRoute(request, sessionMatch[1] ?? "", sessionMatch[2] ?? "");
    return hasCsrf(request) ? startSession(request) : problem(PROBLEMS.csrf, request.path);
  };
}

/** One ready-made instance, used by mock-app.ts until it builds one per mocked api. */
export const mockSessionRoute: MockRoute = createMockSessionRoute();
