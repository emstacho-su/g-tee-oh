/**
 * Mocked range-painting routes for the shots and mock projects (S27 lane B, R3.17, O-264, O-300,
 * O-302): GET /drills (the picker's list), POST /sessions with mode range_paint, GET
 * /range-paint/{session}/next and POST /range-paint/submit over the synthetic fixtures in
 * src/fixtures/paint.ts.
 *
 * Mechanism: createMockPaintRoute returns a route with its own in-memory state: the sessions it
 * started, each with its state version, its prompt counter and its Idempotency-Key replies. Every
 * route answers 401 when signed out, and the POSTs answer 403 csrf unless x-csrf-token equals the
 * fixture token, as the api does (O-230). POST /sessions is answered only for mode range_paint
 * (any other mode returns undefined, so mock-sessions.ts answers drill sessions; mock-app.ts lists
 * this route first): a fixture drill starts a session (201), another id is 404, a bad body or seed
 * 400; since S41 a catalog spot starts one too, checked as the api checks it (mock-catalog-spot.ts:
 * 400 for a bad spot, 422 no-coverage for an uncovered seat, O-415). GET next is pure: the fixture prompt at the session's version and counter. Submit checks the
 * body shape (400), the session (404), the version and the node (409 stale-state) and that the
 * paint names exactly the prompt's classes with node actions (400), then grades it with the
 * fixture's formula (fixturePaintResult) and advances the version and the counter; a repeat with
 * the same Idempotency-Key replays the first answer (O-232).
 */
import type { PracticeSession, RangePaintPrompt } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { fixturePaintDrills, fixturePaintPrompt, fixturePaintResult, fixturePaintSession } from "../../src/fixtures/paint.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";
import { catalogSpotProblem } from "./mock-catalog-spot.js";

const STATUS = { ok: 200, created: 201 } as const;
const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  stale: { status: 409, slug: "stale-state", title: "Stale state" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

const DRILLS_PATH = "/api/v1/drills";
const SESSIONS_PATH = "/api/v1/sessions";
const NEXT_PATH = /^\/api\/v1\/range-paint\/([^/]+)\/next$/;
const SUBMIT_PATH = "/api/v1/range-paint/submit";
const PAINT_MODE = "range_paint";
const SEED_PATTERN = /^[0-9a-f]{16}$/;
const IDEMPOTENCY_HEADER = "idempotency-key";
const SESSION_ID_PREFIX = "00000000-0000-4000-8000-";
const SESSION_ID_DIGITS = 12;
/** The first session takes the fixture's session id (…0270). */
const FIRST_SESSION_NUMBER = 0x270;

interface PaintSession {
  readonly id: string;
  readonly version: number;
  readonly counter: number;
  readonly replies: ReadonlyMap<string, MockResponse>;
}

interface SubmitBody {
  session_id: string;
  state_version: number;
  node_key: string;
  paint: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSubmitBody(body: unknown): body is SubmitBody {
  if (!isRecord(body) || !isRecord(body["paint"])) return false;
  const indexesOk = Object.values(body["paint"]).every(isNonNegativeInteger);
  return typeof body["session_id"] === "string" && isNonNegativeInteger(body["state_version"]) && typeof body["node_key"] === "string" && indexesOk;
}

function hasCsrf(request: MockRequest): boolean {
  return request.headers[CSRF_HEADER] === FIXTURE_CSRF_TOKEN;
}

function promptOf(session: PaintSession): RangePaintPrompt {
  return { ...fixturePaintPrompt, session_id: session.id, state_version: session.version, prompt_no: session.counter };
}

/** True when the paint names exactly the prompt's classes, each with one of its actions. */
function paintFits(paint: Readonly<Record<string, number>>): boolean {
  const held = new Set(fixturePaintPrompt.hands);
  const indexes = new Set(fixturePaintPrompt.actions.map((action) => action.index));
  const keys = Object.keys(paint);
  return keys.length === held.size && keys.every((hand) => held.has(hand) && indexes.has(paint[hand] ?? -1));
}

/** The problem a POST /sessions body for range_paint earns, or null when it starts a session. */
function startProblem(body: Record<string, unknown>): ProblemSpec | null {
  const drillId = body["drill_id"];
  const seed = body["seed"];
  if (seed !== undefined && (typeof seed !== "string" || !SEED_PATTERN.test(seed))) return PROBLEMS.validation;
  // S41 (O-415): a catalog spot instead of a drill, checked as the api checks it.
  if (body["catalog_spot"] !== undefined) return catalogSpotProblem(body);
  if (typeof drillId !== "string") return PROBLEMS.validation;
  return fixturePaintDrills.some((drill) => drill.id === drillId) ? null : PROBLEMS.notFound;
}

function isPaintStart(request: MockRequest): request is MockRequest & { body: Record<string, unknown> } {
  return request.path === SESSIONS_PATH && request.method.toUpperCase() === "POST" && isRecord(request.body) && request.body["mode"] === PAINT_MODE;
}

/** A fresh set of range-painting routes with their own state. */
export function createMockPaintRoute(): MockRoute {
  let sessions: ReadonlyMap<string, PaintSession> = new Map();
  let started = 0;

  function save(session: PaintSession): void {
    sessions = new Map([...sessions, [session.id, session]]);
  }

  function start(request: MockRequest & { body: Record<string, unknown> }): MockResponse {
    const failure = startProblem(request.body);
    if (failure !== null) return problem(failure, request.path);
    const id = `${SESSION_ID_PREFIX}${(FIRST_SESSION_NUMBER + started).toString(16).padStart(SESSION_ID_DIGITS, "0")}`;
    started += 1;
    save({ id, version: 0, counter: 0, replies: new Map() });
    const drillId = request.body["drill_id"];
    const body: PracticeSession = { ...fixturePaintSession, session_id: id, drill_id: typeof drillId === "string" ? drillId : null };
    return json(STATUS.created, body);
  }

  function grade(session: PaintSession, body: SubmitBody, path: string, key: string | undefined): MockResponse {
    if (body.state_version !== session.version || body.node_key !== fixturePaintPrompt.node_key) return problem(PROBLEMS.stale, path);
    if (!paintFits(body.paint)) return problem(PROBLEMS.validation, path);
    const response = json(STATUS.ok, { ...fixturePaintResult(body.paint, session.version + 1), session_id: session.id });
    const replies = key === undefined ? session.replies : new Map([...session.replies, [key, response]]);
    save({ ...session, version: session.version + 1, counter: session.counter + 1, replies });
    return response;
  }

  function submit(request: MockRequest): MockResponse {
    if (!isSubmitBody(request.body)) return problem(PROBLEMS.validation, request.path);
    const session = sessions.get(request.body.session_id);
    if (session === undefined) return problem(PROBLEMS.notFound, request.path);
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replay = key === undefined ? undefined : session.replies.get(key);
    return replay ?? grade(session, request.body, request.path, key);
  }

  function next(id: string, path: string): MockResponse {
    const session = sessions.get(id);
    return session === undefined ? problem(PROBLEMS.notFound, path) : json(STATUS.ok, promptOf(session));
  }

  return (request, { signedIn }) => {
    const method = request.method.toUpperCase();
    const nextMatch = method === "GET" ? NEXT_PATH.exec(request.path) : null;
    const listing = method === "GET" && request.path === DRILLS_PATH;
    const submitting = method === "POST" && request.path === SUBMIT_PATH;
    const starting = isPaintStart(request);
    if (nextMatch === null && !listing && !submitting && !starting) return undefined;
    if (!signedIn) return problem(UNAUTHENTICATED, request.path);
    if (listing) return json(STATUS.ok, { items: fixturePaintDrills, next_cursor: null });
    if (nextMatch !== null) return next(nextMatch[1] ?? "", request.path);
    if (!hasCsrf(request)) return problem(PROBLEMS.csrf, request.path);
    return isPaintStart(request) ? start(request) : submit(request);
  };
}
