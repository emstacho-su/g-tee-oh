/**
 * Mocked drill and session routes for the shots and mock projects (S25, S26, R3.13, R3.14, O-264):
 * GET /drills/{id}, POST /sessions, GET /sessions/{id}/next, POST /sessions/{id}/decisions and POST
 * /sessions/{id}/end over the synthetic fixtures in src/fixtures/trainer.ts.
 *
 * Mechanism: createMockSessionRoute returns a route with its own in-memory state: the sessions it
 * started, each with its RNG setting, its drill's stop rule, the hand it is at, its state version,
 * the decisions graded so far, the Idempotency-Key replies and the recap once ended. Every route
 * answers 401 when signed out, and the three POSTs answer 403 csrf unless x-csrf-token equals the
 * fixture token, as the api does (O-230). POST /sessions takes mode drill with a known drill (201,
 * with its coverage, O-312), answers 422 no-coverage for the uncovered fixture drill with the
 * typed pairs_total and pairs_queued members (ADR 0018, PR #30 review MEDIUM 3) and 400 for a bad
 * body or seed. GET /next is pure: the
 * current prompt, with the roll only in RNG mode (O-282). A decision for an older state version is
 * a 409 stale-state; a repeat with the same Idempotency-Key replays the first answer (O-232); a
 * correct one advances the hand and the version. Choosing an action in best_action_indexes is
 * labeled best. End answers the recap of the decisions made and the session then refuses more
 * with 409 session-ended. mockSessionRoute is one ready-made instance.
 *
 * Drills (S26): options.drillOf lets another mocked route (mock-drills.ts) supply drills; the
 * fixture drills stay the fallback. The drill's trainer.stop_rule drives the session:
 * - after_action (spot mode) deals the fixture hands in a cycle exactly as S25 did;
 * - end_of_street and end_of_hand deal the street hands: the hero's first decision, then (unless
 *   the hero folded) the opponents' answer appended to the history and the hero's second decision
 *   (hand_decision_no 1, then 2, from the fixture prompts, O-335);
 *   the hand then ends and the next hand's prompt has a larger hand_no and previous_hand: a fold
 *   ends with end fold, otherwise the street closes (with the opponent's call after a raise), and
 *   in end_of_hand mode the board holds the three flop cards (v1 ends a full hand at the flop).
 *
 * Automated and holdout sessions (S32, R4.10, O-328): POST /sessions with mode automated or
 * holdout, and those sessions' next, decisions and end, go to mock-automated.ts (blocks of three
 * hands with their class, rated outside worked examples, a SessionRecap with rating changes);
 * options.onEnd sees each such session's recap the first time it ends.
 */
import type { DecisionFeedback, NodeAction, Problem, TrainerPrompt } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_PART_COVERED_DRILL_ID,
  FIXTURE_UNCOVERED_DRILL_ID,
  fixtureDrill,
  fixtureFullCoverage,
  fixtureFullHandDrill,
  fixturePartCoverage,
  fixturePartCoveredDrill,
  fixtureStreetDrill,
  fixtureStreetHands,
  fixtureFollowedRoll,
  fixtureTrainerHands,
  heroEntry,
  type FixtureHand,
  type FixtureHistoryEntry,
  type FixtureStreetHand,
} from "../../src/fixtures/trainer.js";
import type { Drill, PracticeSession, PreviousHand, SessionRecap, StopRule } from "../../src/trainer/session-types.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";
import { createAutomatedSessions, type AutomatedSessionOptions } from "./mock-automated.js";

const STATUS = { ok: 200, created: 201 } as const;
const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  stale: { status: 409, slug: "stale-state", title: "Stale state" },
  ended: { status: 409, slug: "session-ended", title: "Session ended" },
  noCoverage: { status: 422, slug: "no-coverage", title: "No coverage" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;
/** The api's 422 detail (services/api/src/sessions/service.ts); the web never shows or parses it. */
const NO_COVERAGE_DETAIL = "This drill cannot be dealt: the library covers none of this drill's spots.";
/** The 422's typed extension members (review MEDIUM 3, O-318): the uncovered drill's one pair, queued. */
const UNCOVERED_COUNTS = { pairs_total: 1, pairs_queued: 1 } as const;

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

export interface MockSessionOptions extends AutomatedSessionOptions {
  /** Drills another mocked route holds; the fixture drills answer when it has none by that id. */
  readonly drillOf?: (id: string) => Drill | undefined;
}

const TRAINING_MODES: ReadonlySet<unknown> = new Set(["automated", "holdout"]);

function isTrainingStart(body: unknown): boolean {
  return isRecord(body) && TRAINING_MODES.has(body["mode"]);
}

const FIXTURE_DRILLS: readonly Drill[] = [
  fixtureDrill,
  { ...fixtureDrill, id: FIXTURE_UNCOVERED_DRILL_ID, name: "A drill the library does not cover" },
  fixtureStreetDrill,
  fixtureFullHandDrill,
  fixturePartCoveredDrill,
];

function fixtureDrillOf(id: string): Drill | undefined {
  return FIXTURE_DRILLS.find((drill) => drill.id === id);
}

interface Graded {
  readonly score: number;
  readonly evLossBb: number;
}

/** In street and full-hand modes: the hero's first action once taken, for the second decision. */
interface StreetStep {
  readonly opened: NodeAction | null;
  readonly previous: PreviousHand | null;
}

interface MockSession {
  readonly id: string;
  readonly rng: boolean;
  readonly stopRule: StopRule;
  readonly hand: number;
  readonly version: number;
  readonly street: StreetStep;
  readonly graded: readonly Graded[];
  readonly replies: ReadonlyMap<string, MockResponse>;
  readonly recap: SessionRecap | null;
}

interface DecisionBody {
  state_version: number;
  action_index: number;
  response_ms: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isDecisionBody(body: unknown): body is DecisionBody {
  if (!isRecord(body)) return false;
  // The api's body is strict and the confidence tap is retired: a body that still sends it is a 400 (O-345, O-373).
  if ("confidence" in body) return false;
  return isNonNegativeInteger(body["state_version"]) && isNonNegativeInteger(body["action_index"]) && isNonNegativeInteger(body["response_ms"]);
}

function cycled<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new RangeError("the fixture session has no hands");
  return item;
}

function isSpotMode(session: MockSession): boolean {
  return session.stopRule === "after_action";
}

function streetHandOf(session: MockSession): FixtureStreetHand {
  return cycled(fixtureStreetHands, session.hand);
}

/** The decision the session is at: a spot hand, or a street hand's first or second decision. */
function decisionAt(session: MockSession): FixtureHand {
  if (isSpotMode(session)) return cycled(fixtureTrainerHands, session.hand);
  const street = streetHandOf(session);
  return session.street.opened === null ? street.first : street.second;
}

function streetPrompt(session: MockSession, hand: FixtureHand): TrainerPrompt {
  const street = streetHandOf(session);
  const { opened, previous } = session.street;
  const history = opened === null ? hand.prompt.history : [...street.first.prompt.history, heroEntry(street.first.prompt, opened), ...street.answer];
  return { ...hand.prompt, history, hand_no: session.hand, previous_hand: previous };
}

function promptOf(session: MockSession): TrainerPrompt {
  const hand = decisionAt(session);
  const prompt = isSpotMode(session) ? hand.prompt : streetPrompt(session, hand);
  return { ...prompt, session_id: session.id, state_version: session.version, rng_roll: session.rng ? hand.roll : null };
}

function feedbackOf(session: MockSession, actionIndex: number): DecisionFeedback {
  const hand = decisionAt(session);
  const best = hand.feedback.best_action_indexes.includes(actionIndex);
  const graded = best ? { label: "best" as const, score: BEST_SCORE, ev_loss_bb: 0, ev_loss_pct_pot: 0 } : {};
  const roll = session.rng ? hand.roll : null;
  // The followed-the-roll mark, as the api stores it (O-371); it never changes the label (ADR 0024).
  const followed_roll = fixtureFollowedRoll(promptOf(session), hand.feedback, actionIndex, roll);
  return { ...hand.feedback, ...graded, state_version: session.version + 1, rng_roll: roll, followed_roll };
}

/** How a street hand ends after the hero's action: a fold, or the street closing (the flop in full-hand mode). */
function endedHand(session: MockSession, history: readonly FixtureHistoryEntry[], action: NodeAction): PreviousHand {
  const street = streetHandOf(session);
  if (action.kind === "fold") return { hand_no: session.hand, history: [...history], board: [], end: "fold" };
  const closed = action.kind === "call" ? history : [...history, street.closing];
  const board = session.stopRule === "end_of_hand" ? [...street.flop] : [];
  return { hand_no: session.hand, history: [...closed], board, end: "street_closed" };
}

/** The session after the hero's action in street or full-hand mode. */
function afterStreetAction(session: MockSession, action: NodeAction): Pick<MockSession, "hand" | "street"> {
  const prompt = promptOf(session);
  const history = [...prompt.history, heroEntry(prompt, action)];
  if (session.street.opened === null && action.kind !== "fold") return { hand: session.hand, street: { ...session.street, opened: action } };
  return { hand: session.hand + 1, street: { opened: null, previous: endedHand(session, history, action) } };
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

function noCoverage(path: string): MockResponse {
  const refused = problem(PROBLEMS.noCoverage, path);
  return { ...refused, body: { ...(refused.body as Problem), detail: NO_COVERAGE_DETAIL, ...UNCOVERED_COUNTS } };
}

/** The problem a POST /sessions body earns, or the drill it starts a session on. */
function startTarget(body: unknown, drillOf: (id: string) => Drill | undefined): ProblemSpec | Drill {
  if (!isRecord(body) || body["mode"] !== "drill" || typeof body["drill_id"] !== "string") return PROBLEMS.validation;
  const seed = body["seed"];
  if (seed !== undefined && (typeof seed !== "string" || !SEED_PATTERN.test(seed))) return PROBLEMS.validation;
  if (body["drill_id"] === FIXTURE_UNCOVERED_DRILL_ID) return PROBLEMS.noCoverage;
  return drillOf(body["drill_id"]) ?? PROBLEMS.notFound;
}

function rngOf(body: unknown, drill: Drill): boolean {
  const settings = isRecord(body) ? body["settings"] : undefined;
  const rng = isRecord(settings) ? settings["rng"] : undefined;
  return typeof rng === "boolean" ? rng : drill.trainer.rng;
}

/** A fresh set of session routes with their own state. */
export function createMockSessionRoute(options: MockSessionOptions = {}): MockRoute {
  let sessions: ReadonlyMap<string, MockSession> = new Map();
  let started = 0;
  const drillOf = (id: string): Drill | undefined => options.drillOf?.(id) ?? fixtureDrillOf(id);
  const training = createAutomatedSessions(options.onEnd === undefined ? {} : { onEnd: options.onEnd });

  function save(session: MockSession): void {
    sessions = new Map([...sessions, [session.id, session]]);
  }

  function startSession(request: MockRequest): MockResponse {
    if (isTrainingStart(request.body)) return training.start(request);
    const target = startTarget(request.body, drillOf);
    if (target === PROBLEMS.noCoverage) return noCoverage(request.path);
    if (!("trainer" in target)) return problem(target, request.path);
    const number = FIRST_SESSION_NUMBER + started;
    started += 1;
    const id = `${SESSION_ID_PREFIX}${number.toString(16).padStart(SESSION_ID_DIGITS, "0")}`;
    const session: MockSession = {
      id,
      rng: rngOf(request.body, target),
      stopRule: target.trainer.stop_rule,
      hand: 0,
      version: 1,
      street: { opened: null, previous: null },
      graded: [],
      replies: new Map(),
      recap: null,
    };
    save(session);
    const coverage = target.id === FIXTURE_PART_COVERED_DRILL_ID ? fixturePartCoverage : fixtureFullCoverage;
    const body: PracticeSession = { session_id: id, mode: "drill", drill_id: target.id, state: "await_hero", state_version: session.version, started_at: STARTED_AT, rated_eligible: false, automated: null, holdout: null, coverage };
    return json(STATUS.created, body);
  }

  function decide(session: MockSession, request: MockRequest): MockResponse {
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replay = key === undefined ? undefined : session.replies.get(key);
    if (replay !== undefined) return replay;
    if (!isDecisionBody(request.body)) return problem(PROBLEMS.validation, request.path);
    if (request.body.state_version !== session.version) return problem(PROBLEMS.stale, request.path);
    const actionIndex = request.body.action_index;
    const action = decisionAt(session).prompt.buttons.find((button) => button.index === actionIndex);
    if (action === undefined) return problem(PROBLEMS.validation, request.path);
    const feedback = feedbackOf(session, actionIndex);
    const response = json(STATUS.ok, feedback);
    const moved = isSpotMode(session) ? { hand: session.hand + 1 } : afterStreetAction(session, action);
    save({
      ...session,
      ...moved,
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
    if (training.owns(id)) return training.route(request, id, action);
    const session = sessions.get(id);
    if (session === undefined) return problem(PROBLEMS.notFound, request.path);
    if (action === "end") return end(session);
    if (session.recap !== null) return problem(PROBLEMS.ended, request.path);
    return reading ? json(STATUS.ok, promptOf(session)) : decide(session, request);
  }

  function drillResponse(id: string, path: string): MockResponse {
    const drill = drillOf(id);
    return drill === undefined ? problem(PROBLEMS.notFound, path) : json(STATUS.ok, drill);
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

/** One ready-made instance, used where a mocked api needs no state of its own. */
export const mockSessionRoute: MockRoute = createMockSessionRoute();
