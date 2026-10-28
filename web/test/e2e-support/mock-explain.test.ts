// Tests for e2e/support/mock-explain.ts (S27 lane D, R3.19, R3.20, O-264, O-305 to O-308): the
// mocked Ask status, More info and Ask routes the shots use. The route is a pure function over
// its own state, so these call it through createMockApi with no browser.
import { describe, expect, it } from "vitest";

import { CSRF_HEADER, createMockApi, type MockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { createMockExplainRoute, MOCK_ASK_STATUS_HEADER, MOCK_ASK_WARNING_TRIGGER } from "../../e2e/support/mock-explain.js";
import { FIXTURE_CSRF_TOKEN, FIXTURE_USER_EMAIL, fixtureFeedback } from "../../src/fixtures/index.js";
import {
  fixtureAskAnswer,
  fixtureAskStatus,
  fixtureAskStatusCapReached,
  fixtureAskStatusFlagOff,
  fixtureAskWarning,
  fixtureMoreInfo,
} from "../../src/fixtures/explain.js";

const ATTEMPT = fixtureFeedback.attempt_id;
const STATUS_PATH = "/api/v1/explain/status";
const MORE_INFO_PATH = `/api/v1/explain/${ATTEMPT}/more-info`;
const ASK_PATH = `/api/v1/explain/${ATTEMPT}/ask`;
const SIGNED = { [CSRF_HEADER]: FIXTURE_CSRF_TOKEN };

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

function signedInApi(route = createMockExplainRoute()): MockApi {
  const api = createMockApi({ routes: [route] });
  api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
  return api;
}

function ask(api: MockApi, question: unknown, headers: Record<string, string> = SIGNED, path = ASK_PATH) {
  return api.handle(request("POST", path, { headers, body: { question } }));
}

function slugOf(body: unknown): string {
  return String((body as { type: string }).type).replace("urn:g-tee-oh:problem:", "");
}

describe("R3.20 mocked explain routes: status", () => {
  it("R3.20 other paths and methods pass through", () => {
    const route = createMockExplainRoute();
    expect(route(request("GET", "/api/v1/stakes"), { signedIn: true })).toBeUndefined();
    expect(route(request("POST", STATUS_PATH), { signedIn: true })).toBeUndefined();
    expect(route(request("GET", ASK_PATH), { signedIn: true })).toBeUndefined();
  });

  it("R3.20 every route answers 401 when signed out", () => {
    const api = createMockApi({ routes: [createMockExplainRoute()] });
    for (const [method, path] of [["GET", STATUS_PATH], ["GET", MORE_INFO_PATH], ["POST", ASK_PATH]] as const) {
      expect(api.handle(request(method, path, { headers: SIGNED })).status).toBe(401);
    }
  });

  it("R3.20 the status is ok by default, set by the option, and switched per request by the header", () => {
    expect(signedInApi().handle(request("GET", STATUS_PATH)).body).toEqual(fixtureAskStatus);
    const capped = signedInApi(createMockExplainRoute({ reason: "cap_reached" }));
    expect(capped.handle(request("GET", STATUS_PATH)).body).toEqual(fixtureAskStatusCapReached);
    const api = signedInApi();
    const flagOff = api.handle(request("GET", STATUS_PATH, { headers: { [MOCK_ASK_STATUS_HEADER]: "flag_off" } }));
    expect(flagOff.body).toEqual(fixtureAskStatusFlagOff);
    const unknown = api.handle(request("GET", STATUS_PATH, { headers: { [MOCK_ASK_STATUS_HEADER]: "nonsense" } }));
    expect(unknown.body).toEqual(fixtureAskStatus);
  });
});

describe("R3.19 mocked explain routes: More info", () => {
  it("R3.19 answers the fixture sections for any attempt id", () => {
    const api = signedInApi();
    const response = api.handle(request("GET", MORE_INFO_PATH));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(fixtureMoreInfo);
    const other = "00000000-0000-4000-8000-0000000000ff";
    expect(api.handle(request("GET", `/api/v1/explain/${other}/more-info`)).body).toMatchObject({ attempt_id: other });
  });

  it("R3.19 an attempt id that is not a UUID is a 400 validation problem", () => {
    const response = signedInApi().handle(request("GET", "/api/v1/explain/not-a-uuid/more-info"));
    expect(response.status).toBe(400);
    expect(slugOf(response.body)).toBe("validation");
  });
});

describe("R3.20 mocked explain routes: Ask", () => {
  it("R3.20 answers the validated fixture and adds its cost to the month's spend", () => {
    const api = signedInApi();
    const response = ask(api, "Why raise?");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(fixtureAskAnswer);
    const status = api.handle(request("GET", STATUS_PATH)).body as { spent_cents: number };
    expect(status.spent_cents).toBe(fixtureAskStatus.spent_cents + fixtureAskAnswer.cost_cents);
  });

  it("R3.20 a question naming the trigger gets the unvalidated answer with the warning", () => {
    const response = ask(signedInApi(), `Show me the ${MOCK_ASK_WARNING_TRIGGER} answer`);
    expect(response.body).toEqual(fixtureAskWarning);
  });

  it("R3.20 the same question again on the same attempt is cached and costs nothing", () => {
    const api = signedInApi();
    ask(api, "Why raise?");
    const again = ask(api, "  why   RAISE? ");
    expect(again.body).toEqual({ ...fixtureAskAnswer, cached: true, cost_cents: 0 });
    const other = "00000000-0000-4000-8000-0000000000ff";
    const elsewhere = ask(api, "Why raise?", SIGNED, `/api/v1/explain/${other}/ask`);
    expect(elsewhere.body).toMatchObject({ attempt_id: other, cached: false });
  });

  it("R3.20 a repeated Idempotency-Key replays the first answer", () => {
    const api = signedInApi();
    const headers = { ...SIGNED, "idempotency-key": "k1" };
    const first = ask(api, "Why raise?", headers);
    expect(ask(api, "Something else", headers)).toBe(first);
  });

  it("R3.20 refuses without CSRF, with a bad body, or with a bad attempt id", () => {
    const api = signedInApi();
    expect(slugOf(ask(api, "Why?", {}).body)).toBe("csrf");
    expect(ask(api, "   ").status).toBe(400);
    expect(ask(api, "x".repeat(501)).status).toBe(400);
    expect(ask(api, 42).status).toBe(400);
    expect(ask(api, "Why?", SIGNED, "/api/v1/explain/nope/ask").status).toBe(400);
  });

  it("R3.20 flag_off answers 503 ask-disabled and cap_reached 429 ask-cap-reached", () => {
    const api = signedInApi();
    const off = ask(api, "Why?", { ...SIGNED, [MOCK_ASK_STATUS_HEADER]: "flag_off" });
    expect(off.status).toBe(503);
    expect(slugOf(off.body)).toBe("ask-disabled");
    const capped = ask(api, "Why?", { ...SIGNED, [MOCK_ASK_STATUS_HEADER]: "cap_reached" });
    expect(capped.status).toBe(429);
    expect(slugOf(capped.body)).toBe("ask-cap-reached");
  });

  it("R3.20 a cached answer is served even above the cap, since it spends nothing", () => {
    const api = signedInApi();
    ask(api, "Why raise?");
    const cached = ask(api, "Why raise?", { ...SIGNED, [MOCK_ASK_STATUS_HEADER]: "cap_reached" });
    expect(cached.status).toBe(200);
    expect(cached.body).toMatchObject({ cached: true, cost_cents: 0 });
  });
});
