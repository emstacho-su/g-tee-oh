// Tests for e2e/support/mock-paint.ts (S27 lane B, R3.17, O-264, O-302): the mocked range-painting
// routes the shots project uses. The routes are pure functions over their own state, so these call
// them directly through createMockApi with no browser.
import { describe, expect, it } from "vitest";

import { CSRF_HEADER, createMockApi, type MockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { createMockPaintRoute } from "../../e2e/support/mock-paint.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import {
  FIXTURE_PAINT_DRILL_ID,
  FIXTURE_PAINT_SESSION_ID,
  fixtureBestPaint,
  fixturePaintDrills,
  fixturePaintPrompt,
} from "../../src/fixtures/paint.js";

const SIGNED = { [CSRF_HEADER]: FIXTURE_CSRF_TOKEN };
const SUBMIT = "/api/v1/range-paint/submit";

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

function signedInApi(): MockApi {
  const api = createMockApi({ routes: [createMockPaintRoute()] });
  api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
  return api;
}

function start(api: MockApi, body: unknown = { mode: "range_paint", drill_id: FIXTURE_PAINT_DRILL_ID }) {
  return api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body }));
}

function submitBody(version: number, paint: Record<string, number> = fixtureBestPaint(), extra: Record<string, unknown> = {}) {
  return { session_id: FIXTURE_PAINT_SESSION_ID, state_version: version, node_key: fixturePaintPrompt.node_key, paint, ...extra };
}

function submit(api: MockApi, body: unknown, headers: Record<string, string> = SIGNED) {
  return api.handle(request("POST", SUBMIT, { headers, body }));
}

describe("R3.17 mocked range-painting routes", () => {
  it("R3.17 passes other paths and other session modes through", () => {
    const route = createMockPaintRoute();
    expect(route(request("GET", "/api/v1/stakes"), { signedIn: true })).toBeUndefined();
    expect(route(request("POST", "/api/v1/sessions", { body: { mode: "drill" } }), { signedIn: true })).toBeUndefined();
    expect(route(request("POST", "/api/v1/sessions", { body: "x" }), { signedIn: true })).toBeUndefined();
  });

  it("R3.17 answers 401 signed out and 403 without the csrf token", () => {
    const signedOut = createMockApi({ routes: [createMockPaintRoute()] });
    expect(signedOut.handle(request("GET", "/api/v1/drills")).status).toBe(401);
    const api = signedInApi();
    expect(submit(api, submitBody(0), {}).status).toBe(403);
  });

  it("R3.17 lists the fixture drills and starts a range_paint session on one, 404 and 400 otherwise", () => {
    const api = signedInApi();
    expect(api.handle(request("GET", "/api/v1/drills")).body).toEqual({ items: fixturePaintDrills, next_cursor: null });
    const started = start(api);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ session_id: FIXTURE_PAINT_SESSION_ID, mode: "range_paint", drill_id: FIXTURE_PAINT_DRILL_ID });
    expect(start(api, { mode: "range_paint", drill_id: "unknown" }).status).toBe(404);
    expect(start(api, { mode: "range_paint" }).status).toBe(400);
    expect(start(api, { mode: "range_paint", drill_id: FIXTURE_PAINT_DRILL_ID, seed: "XYZ" }).status).toBe(400);
  });

  it("R3.17 starts a catalog-spot range_paint session on a covered seat (O-415)", () => {
    const api = signedInApi();
    const spot = { config_id: "cfg_6_online_100", hero_positions: ["BB"], villain_positions: ["BTN"], spot_types: ["vs_open"] };
    const started = start(api, { mode: "range_paint", catalog_spot: spot, seed: "00000000deadbeef" });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ mode: "range_paint", drill_id: null });
    const id = (started.body as { session_id: string }).session_id;
    expect(api.handle(request("GET", `/api/v1/range-paint/${id}/next`)).status).toBe(200);
  });

  it("R3.17 refuses a catalog spot the api would refuse: unknown table, bad shape, both drill and spot, an uncovered seat", () => {
    const api = signedInApi();
    const spot = { config_id: "cfg_6_online_100", hero_positions: ["BB"], spot_types: ["vs_open"] };
    expect(start(api, { mode: "range_paint", catalog_spot: { ...spot, config_id: "cfg_6_online_999" } }).status).toBe(400);
    expect(start(api, { mode: "range_paint", catalog_spot: { ...spot, spot_types: ["sideways"] } }).status).toBe(400);
    expect(start(api, { mode: "range_paint", catalog_spot: { ...spot, hero_positions: [] } }).status).toBe(400);
    expect(start(api, { mode: "range_paint", catalog_spot: spot, drill_id: FIXTURE_PAINT_DRILL_ID }).status).toBe(400);
    const uncovered = start(api, { mode: "range_paint", catalog_spot: { ...spot, hero_positions: ["UTG"] } });
    expect(uncovered.status).toBe(422);
    expect(uncovered.body).toMatchObject({ type: "urn:g-tee-oh:problem:no-coverage" });
  });

  it("R3.17 next is pure and an unknown session is 404", () => {
    const api = signedInApi();
    start(api);
    const first = api.handle(request("GET", `/api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`));
    expect(first.body).toEqual(fixturePaintPrompt);
    expect(api.handle(request("GET", `/api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`)).body).toEqual(first.body);
    expect(api.handle(request("GET", "/api/v1/range-paint/nope/next")).status).toBe(404);
  });

  it("R3.17 grades a submitted paint, advances the prompt and replays a repeated Idempotency-Key", () => {
    const api = signedInApi();
    start(api);
    const keyed = { ...SIGNED, "idempotency-key": "k1" };
    const graded = submit(api, submitBody(0), keyed);
    expect(graded.status).toBe(200);
    expect(graded.body).toMatchObject({ session_id: FIXTURE_PAINT_SESSION_ID, state_version: 1, total_weighted_loss_bb: 0 });
    expect(submit(api, submitBody(0), keyed)).toEqual(graded);
    expect(api.handle(request("GET", `/api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`)).body).toMatchObject({ state_version: 1, prompt_no: 1 });
  });

  it("R3.17 refuses a stale version, another node, a paint that does not fit, a bad body and an unknown session", () => {
    const api = signedInApi();
    start(api);
    expect(submit(api, submitBody(3)).status).toBe(409);
    expect(submit(api, submitBody(0, fixtureBestPaint(), { node_key: "other" })).status).toBe(409);
    const missing = Object.fromEntries(Object.entries(fixtureBestPaint()).filter(([hand]) => hand !== "AA"));
    expect(submit(api, submitBody(0, missing)).status).toBe(400);
    expect(submit(api, submitBody(0, fixtureBestPaint({ AA: 7 }))).status).toBe(400);
    expect(submit(api, { session_id: FIXTURE_PAINT_SESSION_ID }).status).toBe(400);
    expect(submit(api, submitBody(0, fixtureBestPaint(), { session_id: "nope" })).status).toBe(404);
  });
});
