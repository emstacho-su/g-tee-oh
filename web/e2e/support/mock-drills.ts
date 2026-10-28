/**
 * Mocked drill routes for the component tests, the shots and the mocked flow 2 (S26, R3.14,
 * O-232, O-264, O-310, O-311): GET and POST /drills, GET, PATCH and DELETE /drills/{id}, GET
 * /drills/{id}/export and POST /drills/import, over an in-memory store seeded with the synthetic
 * fixture drills of src/fixtures/trainer.ts.
 *
 * Mechanism: createMockDrillRoute returns a route with its own state, one per page: the drills in
 * creation order, the ids a practice session uses (the fixture drill, so a delete shows the 409),
 * and the stored answers by Idempotency-Key. It answers as the api does:
 * - signed out, every path is the 401 problem; a write without the fixture CSRF token is the 403
 *   csrf problem (O-230);
 * - the list is newest first, filtered by a valid tag, in pages of limit (default 50) with the
 *   last item's id as next_cursor; a bad tag or an unknown cursor is a 400;
 * - a create or patch body is checked by src/drills/body-rules.ts, the same write rules the
 *   builder runs, and a violation is a 400 validation problem whose errors name "body.<path>";
 * - the export code is g-tee-oh's format (O-310, services/api/src/drills/export-code.ts):
 *   "gteeoh1." and base64url of zlib deflate of the canonical JSON of {name, tags, spot_filter,
 *   trainer}; import guards length, version, base64url, inflate (64 KiB cap), JSON and the write
 *   rules in that order, each a 400 pointing at body.export_code, and creates a new drill;
 * - a repeated write with the same Idempotency-Key replays the first answer (O-232).
 * node:zlib is fine here: the mock runs in Playwright's Node side and in vitest, never in the app.
 * drillOf(id) lets the session mock (mock-sessions.ts) start a session on any drill in the store.
 */
import { deflateSync, inflateSync } from "node:zlib";

import { checkDrillBody } from "../../src/drills/body-rules.js";
import { EXPORT_CODE_PREFIX, MAX_EXPORT_CODE_LENGTH, TAG_PATTERN } from "../../src/drills/limits.js";
import type { Drill, DrillCreate, FieldError } from "../../src/drills/types.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_DRILL_ID,
  FIXTURE_UNCOVERED_DRILL_ID,
  fixtureDrill,
  fixtureFullHandDrill,
  fixturePartCoveredDrill,
  fixtureStreetDrill,
} from "../../src/fixtures/trainer.js";
import { CSRF_HEADER, UNAUTHENTICATED, json, problem, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

export const MOCK_DRILL_PATHS = { list: "/api/v1/drills", import: "/api/v1/drills/import" } as const;
const ONE_PATH = /^\/api\/v1\/drills\/([^/]+)$/;
const EXPORT_PATH = /^\/api\/v1\/drills\/([^/]+)\/export$/;

const STATUS = { ok: 200, created: 201, noContent: 204 } as const;
const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  csrf: { status: 403, slug: "csrf", title: "Cross-site request forgery check failed" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  conflict: { status: 409, slug: "conflict", title: "Conflict" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

const IDEMPOTENCY_HEADER = "idempotency-key";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_INFLATED_BYTES = 64 * 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{2,}$/;
const ID_PREFIX = "00000000-0000-4000-8000-";
const ID_DIGITS = 12;
const FIRST_ID_NUMBER = 0xd000;
const CREATED_BASE_MS = Date.parse("2026-10-28T12:00:00Z");
const MINUTE_MS = 60_000;
const EXPORT_FIELD = "body.export_code";

/** The api's own refusal texts (services/api/src/drills/export-code.ts). */
const CODE_TEXT = {
  tooLong: `The export code is longer than ${MAX_EXPORT_CODE_LENGTH} characters.`,
  version: `The export code does not start with ${EXPORT_CODE_PREFIX}, the export code version this server reads.`,
  malformed: "The export code is damaged: it does not decode to a drill.",
  tooLarge: `The export code expands to more than ${MAX_INFLATED_BYTES} bytes.`,
  invalid: "The export code decodes to a drill this server does not accept.",
} as const;

export interface MockDrillOptions {
  /** The drills the store starts with, oldest first; the two fixture drills by default. */
  readonly seed?: readonly Drill[];
  /** Ids a practice session references, so DELETE answers 409; the fixture drill by default. */
  readonly inUse?: readonly string[];
}

export interface MockDrillRoute extends MockRoute {
  /** The drill the store holds under this id, if any. */
  readonly drillOf: (id: string) => Drill | undefined;
}

export const fixtureUncoveredDrill: Drill = {
  ...fixtureDrill,
  id: FIXTURE_UNCOVERED_DRILL_ID,
  name: "A drill the library does not cover",
  tags: ["synthetic", "uncovered"],
};

/** The default store, oldest first: every synthetic fixture drill the trainer screens use. */
export const SEEDED_DRILLS: readonly Drill[] = [
  fixtureDrill,
  fixtureStreetDrill,
  fixtureFullHandDrill,
  fixturePartCoveredDrill,
  fixtureUncoveredDrill,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** A problem with a detail and field errors, as the api's validation problems carry. */
function problemWith(spec: ProblemSpec, path: string, detail: string, errors: readonly FieldError[] = []): MockResponse {
  const base = problem(spec, path);
  return { ...base, body: { ...(base.body as object), detail, ...(errors.length === 0 ? {} : { errors }) } };
}

/** Key-sorted JSON at every depth (http/canonical-json.ts), so one drill gives one code. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function encodeMockExportCode(drill: DrillCreate): string {
  const payload = { name: drill.name, tags: drill.tags, spot_filter: drill.spot_filter, trainer: drill.trainer };
  return `${EXPORT_CODE_PREFIX}${deflateSync(Buffer.from(canonicalJson(payload), "utf8")).toString("base64url")}`;
}

/** A body shaped like DrillCreate (types only), with tags defaulted, or null. */
function drillCreateShape(body: unknown): DrillCreate | null {
  if (!isRecord(body) || typeof body["name"] !== "string" || !isRecord(body["spot_filter"]) || !isRecord(body["trainer"])) return null;
  const tags = body["tags"] ?? [];
  if (!isStringList(tags)) return null;
  const filter = body["spot_filter"];
  const game = filter["game_config"];
  const listsOk = ["hero_positions", "villain_positions", "preflop_action"].every((key) => isStringList(filter[key]));
  if (!isRecord(game) || !Array.isArray(game["depths_bb"]) || !listsOk || !isRecord(filter["hands"]) || !isRecord(filter["sizing"])) return null;
  return { name: body["name"], tags, spot_filter: filter as DrillCreate["spot_filter"], trainer: body["trainer"] as DrillCreate["trainer"] };
}

type Checked = { readonly body: DrillCreate } | { readonly errors: readonly FieldError[] };

/** The body when it passes the write rules, else its errors (paths inside the body). */
function checkBody(body: unknown): Checked {
  const shaped = drillCreateShape(body);
  if (shaped === null) return { errors: [{ path: "", message: "the body is not a drill" }] };
  try {
    const errors = checkDrillBody(shaped);
    return errors.length === 0 ? { body: { ...shaped, name: shaped.name.trim() } } : { errors };
  } catch {
    // A body of the right outline with a wrong value type deeper down is refused like a bad shape.
    return { errors: [{ path: "", message: "the body is not a drill" }] };
  }
}

function prefixed(prefix: string, errors: readonly FieldError[]): FieldError[] {
  return errors.map(({ path, message }) => ({ path: path === "" ? prefix : `${prefix}.${path}`, message }));
}

type Decoded = { readonly body: DrillCreate } | { readonly detail: string; readonly errors: readonly FieldError[] };

function refused(detail: string): Decoded {
  return { detail, errors: [{ path: EXPORT_FIELD, message: detail }] };
}

type Inflated = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly detail: string };

function inflatedJson(text: string): Inflated {
  try {
    const bytes = inflateSync(Buffer.from(text, "base64url"), { maxOutputLength: MAX_INFLATED_BYTES });
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch (error: unknown) {
    // zlib stops at the cap with a RangeError; a damaged stream, bad UTF-8 or bad JSON is malformed.
    return { ok: false, detail: error instanceof RangeError ? CODE_TEXT.tooLarge : CODE_TEXT.malformed };
  }
}

/** The drill an export code holds, or why it was refused; the guards run in the api's order. */
export function decodeMockExportCode(code: string): Decoded {
  if (code.length > MAX_EXPORT_CODE_LENGTH) return refused(CODE_TEXT.tooLong);
  if (!code.startsWith(EXPORT_CODE_PREFIX)) return refused(CODE_TEXT.version);
  const text = code.slice(EXPORT_CODE_PREFIX.length);
  if (!BASE64URL_PATTERN.test(text)) return refused(CODE_TEXT.malformed);
  const payload = inflatedJson(text);
  if (!payload.ok) return refused(payload.detail);
  const checked = checkBody(payload.value);
  if ("body" in checked) return checked;
  return { detail: CODE_TEXT.invalid, errors: prefixed(EXPORT_FIELD, checked.errors) };
}

export function createMockDrillRoute(options: MockDrillOptions = {}): MockDrillRoute {
  let drills: readonly Drill[] = options.seed ?? SEEDED_DRILLS;
  const inUse: readonly string[] = options.inUse ?? [FIXTURE_DRILL_ID];
  let replies: ReadonlyMap<string, MockResponse> = new Map();
  let created = 0;

  const find = (id: string) => drills.find((drill) => drill.id === id);

  function store(body: DrillCreate): Drill {
    const stamp = new Date(CREATED_BASE_MS + created * MINUTE_MS).toISOString();
    const id = `${ID_PREFIX}${(FIRST_ID_NUMBER + created).toString(16).padStart(ID_DIGITS, "0")}`;
    created += 1;
    const drill: Drill = { id, ...body, created_at: stamp, updated_at: stamp };
    drills = [...drills, drill];
    return drill;
  }

  function list(request: MockRequest): MockResponse {
    const { tag, cursor, limit: limitText } = request.query;
    if (tag !== undefined && !TAG_PATTERN.test(tag)) return problemWith(PROBLEMS.validation, request.path, "invalid tag");
    const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return problemWith(PROBLEMS.validation, request.path, "invalid limit");
    const newest = [...drills].reverse().filter((drill) => tag === undefined || drill.tags.includes(tag));
    const start = cursor === undefined ? 0 : newest.findIndex((drill) => drill.id === cursor) + 1;
    if (start === 0 && cursor !== undefined) return problemWith(PROBLEMS.validation, request.path, "invalid cursor");
    const items = newest.slice(start, start + limit);
    const more = start + limit < newest.length;
    return json(STATUS.ok, { items, next_cursor: more ? (items.at(-1)?.id ?? null) : null });
  }

  function create(request: MockRequest): MockResponse {
    const checked = checkBody(request.body);
    if ("errors" in checked) return problemWith(PROBLEMS.validation, request.path, "Request validation failed", prefixed("body", checked.errors));
    return json(STATUS.created, store(checked.body));
  }

  function patch(request: MockRequest, drill: Drill): MockResponse {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).length === 0) return problemWith(PROBLEMS.validation, request.path, "at least one field is required");
    const merged = { name: drill.name, tags: drill.tags, spot_filter: drill.spot_filter, trainer: drill.trainer, ...body };
    const checked = checkBody(merged);
    if ("errors" in checked) return problemWith(PROBLEMS.validation, request.path, "Request validation failed", prefixed("body", checked.errors));
    const stamp = new Date(CREATED_BASE_MS + (created + 1) * MINUTE_MS).toISOString();
    const updated: Drill = { ...drill, ...checked.body, updated_at: stamp };
    drills = drills.map((entry) => (entry.id === drill.id ? updated : entry));
    return json(STATUS.ok, updated);
  }

  function remove(request: MockRequest, drill: Drill): MockResponse {
    if (inUse.includes(drill.id)) return problemWith(PROBLEMS.conflict, request.path, "A practice session still references this drill.");
    drills = drills.filter((entry) => entry.id !== drill.id);
    return { status: STATUS.noContent };
  }

  function importCode(request: MockRequest): MockResponse {
    const body = request.body;
    const code = isRecord(body) && Object.keys(body).length === 1 ? body["export_code"] : undefined;
    if (typeof code !== "string" || code === "") return problemWith(PROBLEMS.validation, request.path, "Request validation failed", [{ path: EXPORT_FIELD, message: "required" }]);
    const decoded = decodeMockExportCode(code);
    if ("detail" in decoded) return problemWith(PROBLEMS.validation, request.path, decoded.detail, decoded.errors);
    return json(STATUS.created, store(decoded.body));
  }

  function write(request: MockRequest, method: string): MockResponse | undefined {
    if (method === "POST" && request.path === MOCK_DRILL_PATHS.list) return create(request);
    if (method === "POST" && request.path === MOCK_DRILL_PATHS.import) return importCode(request);
    const id = ONE_PATH.exec(request.path)?.[1];
    if (id === undefined || (method !== "PATCH" && method !== "DELETE")) return undefined;
    const drill = find(id);
    if (drill === undefined) return problemWith(PROBLEMS.notFound, request.path, "No drill of yours has this id.");
    return method === "PATCH" ? patch(request, drill) : remove(request, drill);
  }

  function read(request: MockRequest): MockResponse | undefined {
    if (request.path === MOCK_DRILL_PATHS.list) return list(request);
    const exportId = EXPORT_PATH.exec(request.path)?.[1];
    const id = exportId ?? ONE_PATH.exec(request.path)?.[1];
    if (id === undefined || id === "import") return undefined;
    const drill = find(id);
    if (drill === undefined) return problemWith(PROBLEMS.notFound, request.path, "No drill of yours has this id.");
    return exportId === undefined ? json(STATUS.ok, drill) : json(STATUS.ok, { export_code: encodeMockExportCode(drill) });
  }

  function ours(request: MockRequest, method: string): boolean {
    const known = request.path === MOCK_DRILL_PATHS.list || request.path === MOCK_DRILL_PATHS.import || ONE_PATH.test(request.path) || EXPORT_PATH.test(request.path);
    return known && ["GET", "POST", "PATCH", "DELETE"].includes(method);
  }

  function writeOnce(request: MockRequest, method: string): MockResponse | undefined {
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replyKey = key === undefined ? undefined : `${method} ${request.path} ${key}`;
    const replay = replyKey === undefined ? undefined : replies.get(replyKey);
    if (replay !== undefined) return replay;
    const response = write(request, method);
    if (response !== undefined && replyKey !== undefined && response.status < PROBLEMS.validation.status) {
      replies = new Map([...replies, [replyKey, response]]);
    }
    return response;
  }

  const route = (request: MockRequest, context: { readonly signedIn: boolean }): MockResponse | undefined => {
    const method = request.method.toUpperCase();
    if (!ours(request, method)) return undefined;
    if (!context.signedIn) return problem(UNAUTHENTICATED, request.path);
    if (method === "GET") return read(request);
    if (request.headers[CSRF_HEADER] !== FIXTURE_CSRF_TOKEN) return problem(PROBLEMS.csrf, request.path);
    return writeOnce(request, method);
  };
  return Object.assign(route, { drillOf: find });
}
