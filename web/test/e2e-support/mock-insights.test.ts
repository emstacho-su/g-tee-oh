// Tests for e2e/support/mock-insights.ts (S27 lane C, R3.18, O-264, O-304): the mocked range drift
// route the shots use. The route is a pure function, so these call it through createMockApi with
// no browser.
import { describe, expect, it } from "vitest";

import { createMockApi, type MockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { DRIFT_PATH, MOCK_SPOT_CLASS_KEY_MAX_CHARS, createMockInsightsRoute } from "../../e2e/support/mock-insights.js";
import { FIXTURE_SPOT_CLASS_KEY, FIXTURE_USER_EMAIL, fixtureFeedback } from "../../src/fixtures/index.js";
import { fixtureDriftHiddenFor, fixtureDriftShown } from "../../src/fixtures/insights.js";

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

function signedInApi(): MockApi {
  const api = createMockApi({ routes: [createMockInsightsRoute()] });
  api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
  return api;
}

function drift(api: MockApi, query: Record<string, string>) {
  return api.handle(request("GET", DRIFT_PATH, { query }));
}

function slugOf(body: unknown): string {
  return String((body as { type: string }).type).replace("urn:g-tee-oh:problem:", "");
}

describe("R3.18 mocked insight routes", () => {
  it("R3.18 other paths and methods pass through", () => {
    const route = createMockInsightsRoute();
    expect(route(request("GET", "/api/v1/stakes"), { signedIn: true })).toBeUndefined();
    expect(route(request("POST", DRIFT_PATH), { signedIn: true })).toBeUndefined();
  });

  it("R3.18 answers 401 when signed out", () => {
    const api = createMockApi({ routes: [createMockInsightsRoute()] });
    const response = drift(api, { spot_class_key: FIXTURE_SPOT_CLASS_KEY });
    expect(response.status).toBe(401);
    expect(slugOf(response.body)).toBe("unauthenticated");
  });

  it("R3.18 the fixture feedback's spot class gets the shown drift", () => {
    expect(fixtureFeedback.spot_class_key).toBe(FIXTURE_SPOT_CLASS_KEY);
    const response = drift(signedInApi(), { spot_class_key: fixtureFeedback.spot_class_key });
    expect(response).toMatchObject({ status: 200, body: fixtureDriftShown });
    expect(fixtureDriftShown.shown).toBe(true);
  });

  it("R3.18 any other spot class gets a hidden drift with no numbers", () => {
    const response = drift(signedInApi(), { spot_class_key: "another-class" });
    expect(response).toMatchObject({ status: 200, body: fixtureDriftHiddenFor("another-class") });
    expect(response.body).toMatchObject({ shown: false, distance: null, ci_low: null, ci_high: null, by_kind: [] });
  });

  it("R3.18 a missing, empty or oversized spot_class_key is a 400 validation problem", () => {
    const api = signedInApi();
    for (const query of [{}, { spot_class_key: "" }, { spot_class_key: "k".repeat(MOCK_SPOT_CLASS_KEY_MAX_CHARS + 1) }]) {
      const response = drift(api, query);
      expect(response.status).toBe(400);
      expect(slugOf(response.body)).toBe("validation");
    }
  });
});
