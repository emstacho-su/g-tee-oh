/**
 * App api client tests (R3.13, O-230). The client runs over an injected fake fetch, so every
 * request it sends is counted. They pin the CSRF (cross-site request forgery) contract: the
 * token lives in memory only, a mutation after a reload recovers it through GET /me first, a 403
 * csrf answer earns exactly one refetch and one retry, and a forbidden-origin 403 is never retried.
 */
import { describe, expect, it } from "vitest";

import { AUTO_CSRF_HEADER, createAppApi, createCsrfTokenHolder, getAppApi } from "../../src/api/index.js";
import { createFakeFetch, jsonResponse, noContent, problemResponse, sessionResponse } from "./fake-fetch.js";

const ORIGIN = "http://localhost:4173";
const DRILL_PATH = "/api/v1/drills/{id}";
const DRILL_ID = "00000000-0000-4000-8000-0000000000aa";
const DRILL_URL_PATH = `/api/v1/drills/${DRILL_ID}`;

function deleteDrill(api: ReturnType<typeof createAppApi>) {
  return api.client.DELETE(DRILL_PATH, { params: { path: { id: DRILL_ID }, header: AUTO_CSRF_HEADER } });
}

describe("app api client, CSRF token", () => {
  it("R3.13 the token holder starts empty and keeps only what it is given", () => {
    const tokens = createCsrfTokenHolder();
    expect(tokens.get()).toBeNull();
    tokens.set("abc");
    expect(tokens.get()).toBe("abc");
    tokens.clear();
    expect(tokens.get()).toBeNull();
  });

  it("R3.13 a token set before the call is sent as x-csrf-token on POST, PATCH and DELETE", async () => {
    const fake = createFakeFetch({
      [`DELETE ${DRILL_URL_PATH}`]: [noContent()],
      [`PATCH ${DRILL_URL_PATH}`]: [problemResponse(501, "not-implemented")],
      "POST /api/v1/auth/logout": [noContent()],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
    api.tokens.set("held-token");

    await deleteDrill(api);
    await api.client.PATCH(DRILL_PATH, { params: { path: { id: DRILL_ID }, header: AUTO_CSRF_HEADER }, body: { name: "x" } as never });
    await api.client.POST("/api/v1/auth/logout");

    expect(fake.keys()).toEqual([`DELETE ${DRILL_URL_PATH}`, `PATCH ${DRILL_URL_PATH}`, "POST /api/v1/auth/logout"]);
    expect(fake.calls.map((call) => call.csrf)).toEqual(["held-token", "held-token", "held-token"]);
  });

  it("R3.13 GET requests and login carry no token and never trigger a /me fetch", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("me-token")],
      "POST /api/v1/auth/login": [sessionResponse("login-token")],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });

    await api.client.POST("/api/v1/auth/login", { body: { email: "owner@example.com", password: "pw" } });
    await api.client.GET("/api/v1/me");

    expect(fake.keys()).toEqual(["POST /api/v1/auth/login", "GET /api/v1/me"]);
    expect(fake.calls.every((call) => call.csrf === null)).toBe(true);
  });

  it("R3.13 after a reload the first mutation awaits GET /me and sends the recovered token", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("recovered-token")],
      [`DELETE ${DRILL_URL_PATH}`]: [noContent()],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });

    const result = await deleteDrill(api);

    expect(result.response.status).toBe(204);
    expect(fake.keys()).toEqual(["GET /api/v1/me", `DELETE ${DRILL_URL_PATH}`]);
    expect(fake.calls[1]?.csrf).toBe("recovered-token");
    expect(api.tokens.get()).toBe("recovered-token");
  });

  it("R3.13 concurrent first mutations share one /me fetch", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("shared-token")],
      [`DELETE ${DRILL_URL_PATH}`]: [noContent()],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });

    await Promise.all([deleteDrill(api), deleteDrill(api)]);

    expect(fake.keys().filter((key) => key === "GET /api/v1/me")).toHaveLength(1);
    expect(fake.calls.filter((call) => call.method === "DELETE").map((call) => call.csrf)).toEqual([
      "shared-token",
      "shared-token",
    ]);
  });

  it("R3.13 when /me answers 401 the mutation goes out without a token and the holder stays empty", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [problemResponse(401, "unauthenticated")],
      "POST /api/v1/auth/logout": [noContent()],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });

    await api.client.POST("/api/v1/auth/logout");

    expect(fake.keys()).toEqual(["GET /api/v1/me", "POST /api/v1/auth/logout"]);
    expect(fake.calls[1]?.csrf).toBeNull();
    expect(api.tokens.get()).toBeNull();
  });

  it("R3.13 the caller's placeholder header is dropped when no token can be recovered", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [problemResponse(401, "unauthenticated")],
      [`DELETE ${DRILL_URL_PATH}`]: [problemResponse(401, "unauthenticated")],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });

    await deleteDrill(api);

    expect(fake.keys()).toEqual(["GET /api/v1/me", `DELETE ${DRILL_URL_PATH}`]);
    expect(fake.calls[1]?.csrf).toBeNull();
  });

  it("R3.13 a /me body without a csrf_token string leaves the holder empty", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [jsonResponse(200, { user: {} })],
      "POST /api/v1/auth/logout": [noContent()],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });

    await api.client.POST("/api/v1/auth/logout");

    expect(fake.calls[1]?.csrf).toBeNull();
    expect(api.tokens.get()).toBeNull();
  });
});

describe("app api client, 403 csrf retry", () => {
  it("R3.13 a 403 csrf answer refetches /me once and retries once with the new token", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("fresh-token")],
      [`DELETE ${DRILL_URL_PATH}`]: [problemResponse(403, "csrf"), noContent()],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
    api.tokens.set("stale-token");

    const result = await deleteDrill(api);

    expect(result.response.status).toBe(204);
    expect(fake.keys()).toEqual([`DELETE ${DRILL_URL_PATH}`, "GET /api/v1/me", `DELETE ${DRILL_URL_PATH}`]);
    expect(fake.calls.map((call) => call.csrf)).toEqual(["stale-token", null, "fresh-token"]);
    expect(api.tokens.get()).toBe("fresh-token");
  });

  it("R3.13 the retry resends the original request body", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("fresh-token")],
      [`PATCH ${DRILL_URL_PATH}`]: [problemResponse(403, "csrf"), problemResponse(501, "not-implemented")],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
    api.tokens.set("stale-token");

    await api.client.PATCH(DRILL_PATH, { params: { path: { id: DRILL_ID }, header: AUTO_CSRF_HEADER }, body: { name: "renamed" } as never });

    const patches = fake.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]?.body).toBe(patches[0]?.body);
    expect(patches[1]?.body).toContain("renamed");
  });

  it("R3.13 a second 403 csrf is returned to the caller with no further refetch or retry", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("fresh-token")],
      [`DELETE ${DRILL_URL_PATH}`]: [problemResponse(403, "csrf")],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
    api.tokens.set("stale-token");

    const result = await deleteDrill(api);

    expect(result.response.status).toBe(403);
    expect(result.error).toMatchObject({ type: "urn:g-tee-oh:problem:csrf" });
    expect(fake.calls).toHaveLength(3);
    expect(fake.keys()).toEqual([`DELETE ${DRILL_URL_PATH}`, "GET /api/v1/me", `DELETE ${DRILL_URL_PATH}`]);
  });

  it("R3.13 a 403 forbidden-origin answer is never retried", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [sessionResponse("fresh-token")],
      [`DELETE ${DRILL_URL_PATH}`]: [problemResponse(403, "forbidden-origin")],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
    api.tokens.set("held-token");

    const result = await deleteDrill(api);

    expect(result.response.status).toBe(403);
    expect(fake.keys()).toEqual([`DELETE ${DRILL_URL_PATH}`]);
  });

  it("R3.13 when the /me refetch fails the original 403 csrf is returned without a retry", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/me": [problemResponse(401, "unauthenticated")],
      [`DELETE ${DRILL_URL_PATH}`]: [problemResponse(403, "csrf")],
    });
    const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
    api.tokens.set("stale-token");

    const result = await deleteDrill(api);

    expect(result.response.status).toBe(403);
    expect(fake.keys()).toEqual([`DELETE ${DRILL_URL_PATH}`, "GET /api/v1/me"]);
    expect(api.tokens.get()).toBeNull();
  });
});

describe("app api singleton", () => {
  it("R3.13 getAppApi returns one client built on the page origin", () => {
    const first = getAppApi();
    expect(getAppApi()).toBe(first);
    expect(first.tokens.get()).toBeNull();
  });
});
