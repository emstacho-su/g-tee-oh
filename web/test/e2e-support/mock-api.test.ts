// Tests for e2e/support/mock-api.ts (R3.13, O-264): the mocked api the Playwright mock project
// routes /api/v1/** to. The handler is pure, so these call it directly with no browser.
import { describe, expect, it } from "vitest";

import {
  API_ROUTE_PATTERN,
  CSRF_HEADER,
  createMockApi,
  type MockRequest,
} from "../../e2e/support/mock-api.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL, fixtureSession } from "../../src/fixtures/index.js";

const PROBLEM_JSON = "application/problem+json";
const JSON_TYPE = "application/json";

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, headers: {}, body: undefined, ...init };
}

const ME = request("GET", "/api/v1/me");
const LOGIN = request("POST", "/api/v1/auth/login", {
  body: { email: FIXTURE_USER_EMAIL, password: "any non-empty value" },
});
const LOGOUT_WITH_TOKEN = request("POST", "/api/v1/auth/logout", {
  headers: { [CSRF_HEADER]: FIXTURE_CSRF_TOKEN },
});

describe("R3.13 mock api", () => {
  it("R3.13 routes every /api/v1 path of any origin", () => {
    expect(API_ROUTE_PATTERN).toBe("**/api/v1/**");
  });

  it("R3.13 GET /me answers a 401 problem before any login", () => {
    const response = createMockApi().handle(ME);
    expect(response.status).toBe(401);
    expect(response.contentType).toBe(PROBLEM_JSON);
    expect(response.body).toMatchObject({
      type: "urn:g-tee-oh:problem:unauthenticated",
      status: 401,
      instance: "/api/v1/me",
    });
  });

  it("R3.13 a login for the fixture owner with any non-empty password returns the SessionInfo", () => {
    const api = createMockApi();
    const response = api.handle(LOGIN);
    expect(response).toEqual({ status: 200, contentType: JSON_TYPE, body: fixtureSession });
    expect(api.handle(ME)).toEqual({ status: 200, contentType: JSON_TYPE, body: fixtureSession });
  });

  it("R3.13 the email is matched without surrounding spaces or capitals", () => {
    const api = createMockApi();
    const shouted = request("POST", "/api/v1/auth/login", {
      body: { email: `  ${FIXTURE_USER_EMAIL.toUpperCase()} `, password: "x" },
    });
    expect(api.handle(shouted).status).toBe(200);
  });

  it("R3.13 another email or an empty password gets a 401 problem and stays signed out", () => {
    const api = createMockApi();
    const stranger = request("POST", "/api/v1/auth/login", {
      body: { email: "someone@example.com", password: "secret-value" },
    });
    const empty = request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "" } });
    for (const attempt of [stranger, empty]) {
      const response = api.handle(attempt);
      expect(response.status).toBe(401);
      expect(response.contentType).toBe(PROBLEM_JSON);
    }
    expect(api.handle(ME).status).toBe(401);
  });

  it("R3.13 a login body that is not the contract shape gets a 400 validation problem", () => {
    const api = createMockApi();
    for (const body of [undefined, "text", { email: FIXTURE_USER_EMAIL }, { email: 1, password: "x" }]) {
      const response = api.handle(request("POST", "/api/v1/auth/login", { body }));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ type: "urn:g-tee-oh:problem:validation" });
    }
  });

  it("R3.13 logout without the csrf token is a 403 csrf problem and keeps the session", () => {
    const api = createMockApi();
    api.handle(LOGIN);
    const wrong = request("POST", "/api/v1/auth/logout", { headers: { [CSRF_HEADER]: "not-the-token" } });
    for (const attempt of [request("POST", "/api/v1/auth/logout"), wrong]) {
      const response = api.handle(attempt);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ type: "urn:g-tee-oh:problem:csrf", status: 403 });
    }
    expect(api.handle(ME).status).toBe(200);
  });

  it("R3.13 logout with the token answers 204 and ends the session", () => {
    const api = createMockApi();
    api.handle(LOGIN);
    expect(api.handle(LOGOUT_WITH_TOKEN)).toEqual({ status: 204 });
    expect(api.handle(ME).status).toBe(401);
  });

  it("R3.13 unknown /api/v1 paths and methods answer a 501 problem", () => {
    const api = createMockApi();
    for (const unknown of [request("GET", "/api/v1/stakes"), request("DELETE", "/api/v1/me")]) {
      const response = api.handle(unknown);
      expect(response.status).toBe(501);
      expect(response.body).toMatchObject({ type: "urn:g-tee-oh:problem:not-implemented" });
    }
  });

  it("R3.13 records every request in order so a test can assert what the app sent", () => {
    const api = createMockApi();
    api.handle(ME);
    api.handle(LOGIN);
    api.handle(LOGOUT_WITH_TOKEN);
    expect(api.requests().map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "GET /api/v1/me",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/logout",
    ]);
    expect(api.requests()[2]?.headers[CSRF_HEADER]).toBe(FIXTURE_CSRF_TOKEN);
  });

  it("R3.13 two mock instances keep separate state, one per page", () => {
    const first = createMockApi();
    const second = createMockApi();
    first.handle(LOGIN);
    expect(first.handle(ME).status).toBe(200);
    expect(second.handle(ME).status).toBe(401);
  });
});
