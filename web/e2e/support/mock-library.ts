/**
 * Mocked coverage and admin builder routes for the shots, the mock flow 5 and the component tests
 * (S28, R3.4, R3.5, O-240, O-242, O-264, O-290). The fixtures are synthetic (src/fixtures/library.ts).
 *
 * Mechanism: createMockLibraryRoute returns a route with its own state, one per page: the queue
 * per spot, the stored builder settings and the builder's last announced state. It answers
 * GET /coverage, POST /coverage/requests, GET /admin/builder, PATCH /admin/builder/settings and
 * POST /admin/builder/pause and /resume, as the api does:
 * - a request for a queued flop raises it to the highest other priority plus 1 and answers queued
 *   with position 1; a covered flop, or the preflop of a covered pair, answers covered; anything
 *   else answers recorded (O-240);
 * - a write without the fixture CSRF token answers the 403 csrf problem (O-230);
 * - the admin routes answer 403 forbidden unless the route was made with admin (O-242);
 * - pause stores paused and answers state paused; resume clears it and answers the last
 *   announced state (O-295); a settings PATCH merges the known numeric keys and answers every
 *   stored override, and a key outside the contract answers 400.
 * Signed out, every path answers the 401 problem.
 */
import type { BuilderStatus } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { fixtureBuilderStatus, fixtureCoverage } from "../../src/fixtures/library.js";
import type { Coverage } from "../../src/library/texture-families.js";
import { CSRF_HEADER, json, problem, UNAUTHENTICATED, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

const OK = 200;
const ACCEPTED = 202;
const PATHS = {
  coverage: "/api/v1/coverage",
  requests: "/api/v1/coverage/requests",
  builder: "/api/v1/admin/builder",
  settings: "/api/v1/admin/builder/settings",
  pause: "/api/v1/admin/builder/pause",
  resume: "/api/v1/admin/builder/resume",
} as const;
const OWNED_PATHS: readonly string[] = Object.values(PATHS);

const VALIDATION: ProblemSpec = { status: 400, slug: "validation", title: "Request validation failed" };
const NOT_FOUND: ProblemSpec = { status: 404, slug: "not-found", title: "Not found" };
const CSRF: ProblemSpec = { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" };
const FORBIDDEN: ProblemSpec = { status: 403, slug: "forbidden", title: "Forbidden" };

/** The settings keys the mock accepts in a PATCH, each a number (the screens send no others). */
const NUMERIC_KEYS: readonly string[] = ["cpu_share", "budget_bytes", "k_runouts", "target_pct_pot", "max_seconds_per_line"];
const OVERNIGHT_KEY = "overnight";

export interface MockLibraryOptions {
  /** Whether the session may use the admin routes (O-242); true by default, like the owner fixture. */
  readonly admin?: boolean;
}

type Queue = Coverage["queue"];

function spotKey(configId: string, pair: string): string {
  return `${configId}|${pair}`;
}

/** The queue after raising one job above every other and renumbering, as new objects. */
export function raiseToHead(queue: Queue, jobId: string): Queue {
  const others = queue.filter((entry) => entry.job_id !== jobId);
  const raised = queue.find((entry) => entry.job_id === jobId);
  if (raised === undefined) return queue;
  const top = others.reduce((max, entry) => Math.max(max, entry.priority), Number.NEGATIVE_INFINITY);
  const priority = others.length === 0 ? raised.priority : Math.max(raised.priority, top + 1);
  return [{ ...raised, priority }, ...others].map((entry, index) => ({ ...entry, position: index + 1 }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSettingsPatch(body: unknown): body is Record<string, unknown> {
  if (!isRecord(body)) return false;
  return Object.entries(body).every(([key, value]) =>
    key === OVERNIGHT_KEY ? isRecord(value) : NUMERIC_KEYS.includes(key) && typeof value === "number",
  );
}

export function createMockLibraryRoute(options: MockLibraryOptions = {}): MockRoute {
  const admin = options.admin ?? true;
  let queues: Readonly<Record<string, Queue>> = {};
  let settings: BuilderStatus["settings"] = { ...fixtureBuilderStatus.settings };
  const announced = { state: fixtureBuilderStatus.state, reason: fixtureBuilderStatus.reason };

  function coverageOf(configId: string, pair: string): Coverage | undefined {
    const base = fixtureCoverage(configId, pair);
    if (base === undefined) return undefined;
    return { ...base, queue: queues[spotKey(configId, pair)] ?? base.queue };
  }

  function status(): BuilderStatus {
    const paused = settings["paused"] === true;
    return { ...fixtureBuilderStatus, ...(paused ? { state: "paused", reason: null } : announced), settings };
  }

  function coverage(request: MockRequest): MockResponse {
    const { config_id: configId, pair } = request.query;
    if (configId === undefined || pair === undefined) return problem(VALIDATION, request.path);
    const found = coverageOf(configId, pair);
    return found === undefined ? problem(NOT_FOUND, request.path) : json(OK, found);
  }

  function coverageRequest(request: MockRequest): MockResponse {
    const body = request.body;
    if (!isRecord(body) || typeof body["config_id"] !== "string" || typeof body["pair"] !== "string") {
      return problem(VALIDATION, request.path);
    }
    const flop = typeof body["flop"] === "string" ? body["flop"] : undefined;
    const found = coverageOf(body["config_id"], body["pair"]);
    if (found === undefined) return problem(NOT_FOUND, request.path);
    const covered = flop === undefined ? found.preflop_available : found.flops.some((entry) => entry.flop === flop);
    if (covered) return json(ACCEPTED, { status: "covered", job_id: null, priority: null, queue_position: null });
    const job = flop === undefined ? undefined : found.queue.find((entry) => entry.flop === flop);
    if (job === undefined) return json(ACCEPTED, { status: "recorded", job_id: null, priority: null, queue_position: null });
    const raised = raiseToHead(found.queue, job.job_id);
    queues = { ...queues, [spotKey(found.config_id, found.pair)]: raised };
    const head = raised[0];
    return json(ACCEPTED, { status: "queued", job_id: job.job_id, priority: head?.priority ?? job.priority, queue_position: 1 });
  }

  function patchSettings(request: MockRequest): MockResponse {
    if (!validSettingsPatch(request.body)) return problem(VALIDATION, request.path);
    settings = { ...settings, ...request.body };
    return json(OK, { settings });
  }

  function setPaused(paused: boolean): MockResponse {
    settings = { ...settings, paused };
    return json(OK, status());
  }

  function adminRoute(request: MockRequest, method: string): MockResponse | undefined {
    if (!admin) return problem(FORBIDDEN, request.path);
    if (method === "GET" && request.path === PATHS.builder) return json(OK, status());
    if (method === "PATCH" && request.path === PATHS.settings) return patchSettings(request);
    if (method === "POST" && request.path === PATHS.pause) return setPaused(true);
    if (method === "POST" && request.path === PATHS.resume) return setPaused(false);
    return undefined;
  }

  return (request, context) => {
    if (!OWNED_PATHS.includes(request.path)) return undefined;
    if (!context.signedIn) return problem(UNAUTHENTICATED, request.path);
    const method = request.method.toUpperCase();
    if (method !== "GET" && request.headers[CSRF_HEADER] !== FIXTURE_CSRF_TOKEN) return problem(CSRF, request.path);
    if (method === "GET" && request.path === PATHS.coverage) return coverage(request);
    if (method === "POST" && request.path === PATHS.requests) return coverageRequest(request);
    return request.path.startsWith(PATHS.builder) ? adminRoute(request, method) : undefined;
  };
}
