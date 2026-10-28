// Tests for e2e/support/mock-prediction.ts (S27 lane A, R3.16, O-264, O-302): the mocked drill
// list, prediction session start, next and answer routes the shots project uses. The routes are
// pure functions over their own state, so these call them through createMockApi with no browser.
import { describe, expect, it } from "vitest";

import { CSRF_HEADER, createMockApi, type MockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { createMockPredictionRoute } from "../../e2e/support/mock-prediction.js";
import { createMockSessionRoute } from "../../e2e/support/mock-sessions.js";
import type { PredictionPrompt, PredictionResult } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_PREDICTION_DRILL_ID, fixtureDrillList, fixturePredictions } from "../../src/fixtures/prediction.js";

const SIGNED = { [CSRF_HEADER]: FIXTURE_CSRF_TOKEN };

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

function signedInApi(): MockApi {
  const api = createMockApi({ routes: [createMockPredictionRoute(), createMockSessionRoute()] });
  api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
  return api;
}

function start(api: MockApi, body: Record<string, unknown> = {}): string {
  const response = api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body: { mode: "prediction", drill_id: FIXTURE_PREDICTION_DRILL_ID, ...body } }));
  expect(response.status).toBe(201);
  return (response.body as { session_id: string }).session_id;
}

function next(api: MockApi, id: string): PredictionPrompt {
  const response = api.handle(request("GET", `/api/v1/prediction/${id}/next`));
  expect(response.status).toBe(200);
  return response.body as PredictionPrompt;
}

function answer(api: MockApi, id: string, body: unknown, headers: Record<string, string> = SIGNED) {
  return api.handle(request("POST", `/api/v1/prediction/${id}/answer`, { headers, body }));
}

function rightAnswer(prompt: PredictionPrompt): unknown {
  const truth = fixturePredictions.find((entry) => entry.prompt.answer_kind === prompt.answer_kind)?.truth;
  switch (prompt.answer_kind) {
    case "yes_no":
      return { kind: "yes_no", value: (truth?.share_pct ?? 0) > (prompt.threshold_pct ?? 0) };
    case "percent":
      return { kind: "percent", value: truth?.share_pct ?? 0 };
    case "regions":
      return { kind: "regions", value: truth?.regions ?? [] };
    case "band":
      return { kind: "band", band: truth?.band };
    default:
      return { kind: prompt.answer_kind, action_index: truth?.action_indexes?.[0] };
  }
}

describe("R3.16 mocked prediction routes", () => {
  it("R3.16 every route needs a signed-in user", () => {
    const api = createMockApi({ routes: [createMockPredictionRoute()] });
    expect(api.handle(request("GET", "/api/v1/drills")).status).toBe(401);
    expect(api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body: { mode: "prediction", drill_id: FIXTURE_PREDICTION_DRILL_ID } })).status).toBe(401);
    expect(api.handle(request("GET", "/api/v1/prediction/x/next")).status).toBe(401);
  });

  it("R3.16 GET /drills lists the fixture drills", () => {
    const response = signedInApi().handle(request("GET", "/api/v1/drills"));
    expect(response).toMatchObject({ status: 200, body: fixtureDrillList });
  });

  it("R3.16 POST /sessions answers mode prediction and leaves the drill mode to the session route", () => {
    const api = signedInApi();
    const id = start(api, { seed: "00000000deadbeef" });
    expect(id).toMatch(/^00000000-0000-4000-8000-/);
    const drill = api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body: { mode: "drill", drill_id: FIXTURE_PREDICTION_DRILL_ID } }));
    expect(drill.status).toBe(201);
    expect((drill.body as { mode: string }).mode).toBe("drill");
  });

  it("R3.16 POST /sessions refuses a missing csrf token, a bad seed and an unknown drill", () => {
    const api = signedInApi();
    const body = { mode: "prediction", drill_id: FIXTURE_PREDICTION_DRILL_ID };
    expect(api.handle(request("POST", "/api/v1/sessions", { body })).status).toBe(403);
    expect(api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body: { ...body, seed: "nope" } })).status).toBe(400);
    expect(api.handle(request("POST", "/api/v1/sessions", { headers: SIGNED, body: { ...body, drill_id: "00000000-0000-4000-8000-00000000ffff" } })).status).toBe(404);
  });

  it("R3.16 next is pure and walks the six answer kinds as answers advance", () => {
    const api = signedInApi();
    const id = start(api);
    expect(next(api, id)).toEqual(next(api, id));
    const kinds: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      const prompt = next(api, id);
      kinds.push(prompt.answer_kind);
      const response = answer(api, id, { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: rightAnswer(prompt) });
      expect(response.status).toBe(200);
      expect((response.body as PredictionResult).correct).toBe(true);
    }
    expect(kinds).toEqual(["yes_no", "action", "percent", "band", "regions", "size", "yes_no"]);
  });

  it("R3.16 a right range level 1 answer unlocks level 2; a wrong one does not", () => {
    const api = signedInApi();
    const id = start(api);
    const prompt = next(api, id);
    const wrong = answer(api, id, { prompt_id: prompt.prompt_id, state_version: 0, answer: { kind: "yes_no", value: false } });
    expect(wrong.body).toMatchObject({ correct: false, next_level_unlocked: false, new_level: 1, state_version: 1 });
    const other = start(api);
    const first = next(api, other);
    const right = answer(api, other, { prompt_id: first.prompt_id, state_version: 0, answer: rightAnswer(first) });
    expect(right.body).toMatchObject({ correct: true, next_level_unlocked: true, new_level: 2, window: { answers: 20, correct: 18 } });
  });

  it("R3.16 a stale version or prompt id is 409; a wrong kind or malformed body is 400; an unknown session is 404", () => {
    const api = signedInApi();
    const id = start(api);
    const prompt = next(api, id);
    expect(answer(api, id, { prompt_id: prompt.prompt_id, state_version: 5, answer: rightAnswer(prompt) }).status).toBe(409);
    expect(answer(api, id, { prompt_id: "00000000-0000-8000-8000-00000000ffff", state_version: 0, answer: rightAnswer(prompt) }).status).toBe(409);
    expect(answer(api, id, { prompt_id: prompt.prompt_id, state_version: 0, answer: { kind: "band", band: "0_25" } }).status).toBe(400);
    expect(answer(api, id, { prompt_id: prompt.prompt_id, state_version: 0, answer: { kind: "yes_no", value: true, extra: 1 } }).status).toBe(400);
    expect(answer(api, id, "not json").status).toBe(400);
    expect(answer(api, id, { prompt_id: prompt.prompt_id, state_version: 0, answer: rightAnswer(prompt) }, {}).status).toBe(403);
    expect(api.handle(request("GET", "/api/v1/prediction/00000000-0000-4000-8000-00000000ffff/next")).status).toBe(404);
    expect(api.handle(request("DELETE", `/api/v1/prediction/${id}/next`)).status).toBe(501);
  });

  it("R3.16 every answer kind's shape is checked against the prompt", () => {
    const api = signedInApi();
    const id = start(api);
    const bad: Record<string, unknown> = {
      yes_no: { kind: "yes_no", value: "yes" },
      action: { kind: "action", action_index: 9 },
      percent: { kind: "percent", value: 120 },
      band: { kind: "band", band: "90_100" },
      regions: { kind: "regions", value: ["nowhere"] },
      size: { kind: "size", action_index: 9 },
    };
    for (let step = 0; step < 6; step += 1) {
      const prompt = next(api, id);
      expect(answer(api, id, { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: bad[prompt.answer_kind] }).status, prompt.answer_kind).toBe(400);
      expect(answer(api, id, { prompt_id: prompt.prompt_id, state_version: prompt.state_version, answer: rightAnswer(prompt) }).status).toBe(200);
    }
  });

  it("R3.16 a repeat with the same Idempotency-Key replays the first reply", () => {
    const api = signedInApi();
    const id = start(api);
    const prompt = next(api, id);
    const headers = { ...SIGNED, "idempotency-key": "predict-1" };
    const body = { prompt_id: prompt.prompt_id, state_version: 0, answer: rightAnswer(prompt) };
    const first = answer(api, id, body, headers);
    const again = answer(api, id, body, headers);
    expect(again).toEqual(first);
    expect(next(api, id).state_version).toBe(1);
  });
});
