// Tests for e2e/support/mock-sessions.ts (S25, R3.13, O-264): the mocked drill and session routes
// the shots project uses. The routes are pure functions over their own state, so these call them
// directly through createMockApi with no browser.
import { describe, expect, it } from "vitest";

import { CSRF_HEADER, createMockApi, type MockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { createMockSessionRoute, mockSessionRoute } from "../../e2e/support/mock-sessions.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import {
  FIXTURE_DRILL_ID,
  FIXTURE_FULL_HAND_DRILL_ID,
  FIXTURE_PART_COVERED_DRILL_ID,
  FIXTURE_SEED,
  FIXTURE_STREET_DRILL_ID,
  FIXTURE_UNCOVERED_DRILL_ID,
  fixtureDrill,
  fixtureFullCoverage,
  fixtureFullHandDrill,
  fixturePartCoverage,
  fixtureStreetDrill,
  fixtureStreetHands,
  fixtureTrainerHands,
} from "../../src/fixtures/trainer.js";

const SIGNED = { [CSRF_HEADER]: FIXTURE_CSRF_TOKEN };

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

function signedInApi(): MockApi {
  const api = createMockApi({ routes: [createMockSessionRoute()] });
  api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
  return api;
}

function startBody(rng: boolean, extra: Record<string, unknown> = {}): unknown {
  return { mode: "drill", drill_id: FIXTURE_DRILL_ID, settings: { rng }, ...extra };
}

function start(api: MockApi, rng = false, headers: Record<string, string> = SIGNED): string {
  const response = api.handle(request("POST", "/api/v1/sessions", { headers, body: startBody(rng) }));
  expect(response.status).toBe(201);
  return (response.body as { session_id: string }).session_id;
}

function next(api: MockApi, id: string) {
  return api.handle(request("GET", `/api/v1/sessions/${id}/next`));
}

function decide(api: MockApi, id: string, body: unknown, headers: Record<string, string> = SIGNED) {
  return api.handle(request("POST", `/api/v1/sessions/${id}/decisions`, { headers, body }));
}

interface PromptBody {
  state_version: number;
  rng_roll: number | null;
  hero_position: string;
  session_id: string;
}

describe("R3.13 mocked session routes", () => {
  it("R3.13 the module's route is a ready-made instance and other paths pass through", () => {
    expect(mockSessionRoute(request("GET", "/api/v1/stakes"), { signedIn: true })).toBeUndefined();
    expect(createMockSessionRoute()(request("GET", "/api/v1/drills"), { signedIn: true })).toBeUndefined();
  });

  it("R3.13 every route answers 401 when signed out", () => {
    const api = createMockApi({ routes: [createMockSessionRoute()] });
    for (const [method, path] of [
      ["GET", `/api/v1/drills/${FIXTURE_DRILL_ID}`],
      ["POST", "/api/v1/sessions"],
      ["GET", "/api/v1/sessions/x/next"],
      ["POST", "/api/v1/sessions/x/decisions"],
      ["POST", "/api/v1/sessions/x/end"],
    ] as const) {
      expect(api.handle(request(method, path, { headers: SIGNED })).status).toBe(401);
    }
  });

  it("R3.13 GET /drills/{id} answers the fixture drill, and 404 for an unknown id", () => {
    const api = signedInApi();
    expect(api.handle(request("GET", `/api/v1/drills/${FIXTURE_DRILL_ID}`)).body).toEqual(fixtureDrill);
    expect(api.handle(request("GET", `/api/v1/drills/${FIXTURE_UNCOVERED_DRILL_ID}`)).body).toMatchObject({ id: FIXTURE_UNCOVERED_DRILL_ID });
    expect(api.handle(request("GET", "/api/v1/drills/unknown")).status).toBe(404);
  });

  it("R3.13 the POSTs need the csrf token: 403 csrf without it", () => {
    const api = signedInApi();
    const response = api.handle(request("POST", "/api/v1/sessions", { body: startBody(false) }));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ type: "urn:g-tee-oh:problem:csrf" });
    const id = start(api);
    expect(decide(api, id, { state_version: 0, action_index: 0, response_ms: 1 }, {}).status).toBe(403);
    expect(api.handle(request("POST", `/api/v1/sessions/${id}/end`, { body: {} })).status).toBe(403);
  });

  it("R3.13 POST /sessions validates its body: mode, drill, seed", () => {
    const api = signedInApi();
    const post = (body: unknown) => api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body }));
    expect(post({ mode: "automated" }).status).toBe(400);
    expect(post(startBody(false, { seed: "XYZ" })).status).toBe(400);
    expect(post(startBody(false, { seed: FIXTURE_SEED })).status).toBe(201);
    expect(post({ mode: "drill", drill_id: "unknown" }).status).toBe(404);
    const uncovered = post({ mode: "drill", drill_id: FIXTURE_UNCOVERED_DRILL_ID });
    expect(uncovered.status).toBe(422);
    expect(uncovered.body).toMatchObject({ type: "urn:g-tee-oh:problem:no-coverage" });
  });

  it("R3.13 sessions deal the fixture hands in order with the roll only when RNG is on (O-282)", () => {
    const api = signedInApi();
    const plain = start(api, false);
    const rolled = start(api, true);
    expect(plain).not.toBe(rolled);
    expect(next(api, plain).body).toMatchObject({ session_id: plain, rng_roll: null, hero_position: "BTN" });
    expect(next(api, rolled).body).toMatchObject({ session_id: rolled, rng_roll: fixtureTrainerHands[0]?.roll });
    expect(next(api, "unknown").status).toBe(404);
  });

  it("R3.13 a decision answers feedback, advances the hand and the version, and replays by Idempotency-Key", () => {
    const api = signedInApi();
    const id = start(api, true);
    const prompt = next(api, id).body as PromptBody;
    const body = { state_version: prompt.state_version, action_index: 2, confidence: "sure", response_ms: 900 };
    const headers = { ...SIGNED, "idempotency-key": "k-1" };
    const first = decide(api, id, body, headers);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ label: "best", rng_roll: 37, state_version: prompt.state_version + 1 });
    expect(decide(api, id, body, headers)).toEqual(first);
    const second = next(api, id).body as PromptBody;
    expect(second).toMatchObject({ hero_position: "CO", state_version: prompt.state_version + 1, rng_roll: 82 });
    expect(decide(api, id, body).status).toBe(409);
    expect(decide(api, id, body).body).toMatchObject({ type: "urn:g-tee-oh:problem:stale-state" });
  });

  it("R3.13 a decision that is not the contract shape or names no button is a 400", () => {
    const api = signedInApi();
    const id = start(api);
    const version = (next(api, id).body as PromptBody).state_version;
    expect(decide(api, id, { action_index: 0 }).status).toBe(400);
    expect(decide(api, id, { state_version: version, action_index: 0, response_ms: 1, confidence: "maybe" }).status).toBe(400);
    expect(decide(api, id, { state_version: version, action_index: 9, response_ms: 1 }).status).toBe(400);
    const wrong = decide(api, id, { state_version: version, action_index: 0, response_ms: 1 });
    expect(wrong.body).toMatchObject({ label: "inaccuracy", rng_roll: null });
  });

  it("R3.13 end answers the recap of the decisions made, then the session refuses more", () => {
    const api = signedInApi();
    const id = start(api);
    const empty = api.handle(request("POST", `/api/v1/sessions/${start(api)}/end`, { headers: SIGNED, body: {} }));
    expect(empty.body).toMatchObject({ decisions: 0, rated_decisions: 0, mean_score: null, ev_loss_bb_total: 0 });
    const version = (next(api, id).body as PromptBody).state_version;
    decide(api, id, { state_version: version, action_index: 0, response_ms: 1 });
    const end = api.handle(request("POST", `/api/v1/sessions/${id}/end`, { headers: SIGNED, body: {} }));
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ session_id: id, decisions: 1, rated_decisions: 1, mean_score: 0.84, ev_loss_bb_total: 0.011 });
    expect(api.handle(request("POST", `/api/v1/sessions/${id}/end`, { headers: SIGNED, body: {} })).body).toEqual(end.body);
    expect(next(api, id).status).toBe(409);
    expect(decide(api, id, { state_version: version + 1, action_index: 0, response_ms: 1 }).status).toBe(409);
    expect(api.handle(request("POST", "/api/v1/sessions/unknown/end", { headers: SIGNED, body: {} })).status).toBe(404);
  });
});

interface HandPrompt extends PromptBody {
  hand_no: number;
  history: { position: string; token: string; label: string }[];
  previous_hand: { hand_no: number; history: { position: string; label: string }[]; board: string[]; end: string } | null;
}

function startDrill(api: MockApi, drillId: string) {
  return api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body: { mode: "drill", drill_id: drillId } }));
}

function play(api: MockApi, id: string, actionIndex: number): HandPrompt {
  const version = (next(api, id).body as HandPrompt).state_version;
  expect(decide(api, id, { state_version: version, action_index: actionIndex, response_ms: 1 }).status).toBe(200);
  return next(api, id).body as HandPrompt;
}

const RAISE = 2;
const FOLD = 0;
const CALL = 1;

describe("R3.13 R3.14 mocked session routes in street and full-hand modes (S26)", () => {
  it("R3.14 POST /sessions answers coverage: full for the fixture drill, part for the partly covered drill (O-312)", () => {
    const api = signedInApi();
    expect(startDrill(api, FIXTURE_DRILL_ID).body).toMatchObject({ drill_id: FIXTURE_DRILL_ID, coverage: fixtureFullCoverage });
    expect(startDrill(api, FIXTURE_PART_COVERED_DRILL_ID).body).toMatchObject({ coverage: fixturePartCoverage });
  });

  it("R3.14 the uncovered drill's 422 names the queued count in its detail", () => {
    const refused = startDrill(signedInApi(), FIXTURE_UNCOVERED_DRILL_ID);
    expect(refused.status).toBe(422);
    expect((refused.body as { detail: string }).detail).toMatch(/1 of its 1 spots were queued for the builder/);
  });

  it("R3.13 drillOf supplies drills from another mocked route; the fixtures stay the fallback", () => {
    const custom = { ...fixtureStreetDrill, id: "custom-drill" };
    const api = createMockApi({ routes: [createMockSessionRoute({ drillOf: (id) => (id === custom.id ? custom : undefined) })] });
    api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
    expect(api.handle(request("GET", "/api/v1/drills/custom-drill")).body).toEqual(custom);
    const started = startDrill(api, custom.id);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ drill_id: custom.id });
    expect(startDrill(api, FIXTURE_DRILL_ID).status).toBe(201);
    expect(api.handle(request("GET", `/api/v1/drills/${FIXTURE_FULL_HAND_DRILL_ID}`)).body).toEqual(fixtureFullHandDrill);
  });

  it("R3.13 street mode: two hero decisions in one hand, the opponents' answer between them, then previous_hand", () => {
    const api = signedInApi();
    const id = (startDrill(api, FIXTURE_STREET_DRILL_ID).body as { session_id: string }).session_id;
    const first = next(api, id).body as HandPrompt;
    expect(first).toMatchObject({ hand_no: 0, previous_hand: null, hero_position: "BTN" });
    const second = play(api, id, RAISE);
    expect(second).toMatchObject({ hand_no: 0, hero_position: "BTN", previous_hand: null });
    expect(second.history.slice(-3).map((entry) => `${entry.position} ${entry.label}`)).toEqual(["BTN Raise to 2.5bb", "SB Fold", "BB Raise to 9bb"]);
    const third = play(api, id, RAISE);
    expect(third).toMatchObject({ hand_no: 1, hero_position: "CO" });
    expect(third.previous_hand).toMatchObject({ hand_no: 0, board: [], end: "street_closed" });
    expect(third.previous_hand?.history.slice(-2).map((entry) => `${entry.position} ${entry.label}`)).toEqual(["BTN Raise to 22bb", "BB Call"]);
  });

  it("R3.13 full-hand mode: the ended hand carries the three flop cards", () => {
    const api = signedInApi();
    const id = (startDrill(api, FIXTURE_FULL_HAND_DRILL_ID).body as { session_id: string }).session_id;
    play(api, id, RAISE);
    const nextHand = play(api, id, CALL);
    expect(nextHand.previous_hand).toMatchObject({ hand_no: 0, end: "street_closed", board: fixtureStreetHands[0]?.flop });
    expect(nextHand.previous_hand?.history.at(-1)).toMatchObject({ position: "BTN", label: "Call" });
  });

  it("R3.13 a fold at the first decision ends the hand with end fold and no board", () => {
    const api = signedInApi();
    const id = (startDrill(api, FIXTURE_FULL_HAND_DRILL_ID).body as { session_id: string }).session_id;
    const nextHand = play(api, id, FOLD);
    expect(nextHand).toMatchObject({ hand_no: 1, previous_hand: { hand_no: 0, end: "fold", board: [] } });
  });

  it("R3.13 the second decision checks the action against its own buttons and grades it", () => {
    const api = signedInApi();
    const id = (startDrill(api, FIXTURE_STREET_DRILL_ID).body as { session_id: string }).session_id;
    const second = play(api, id, RAISE);
    const graded = decide(api, id, { state_version: second.state_version, action_index: CALL, response_ms: 1 });
    expect(graded.body).toMatchObject({ label: "best", state_version: second.state_version + 1 });
  });
});
