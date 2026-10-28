/**
 * The mocked coverage and admin routes (S28, R3.4, R3.5, O-240, O-242, O-264) answer as the api
 * does, so the shots and the mock flow 5 exercise real behavior.
 */
import { describe, expect, it } from "vitest";

import type { MockRequest } from "../../e2e/support/mock-api.js";
import { createMockLibraryRoute, raiseToHead } from "../../e2e/support/mock-library.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { FIXTURE_QUEUE, FIXTURE_QUEUE_CONFIG_ID, FIXTURE_QUEUE_PAIR, FIXTURE_REQUESTED_FLOP } from "../../src/fixtures/library.js";

const SIGNED_IN = { signedIn: true };

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: { "x-csrf-token": FIXTURE_CSRF_TOKEN }, body: undefined, ...init };
}

describe("R3.4 R3.5 mocked library routes", () => {
  it("R3.4 raiseToHead puts the job first above every other priority and renumbers, leaving the input alone", () => {
    const raised = raiseToHead(FIXTURE_QUEUE, "00000000-0000-4000-8000-0000000000c3");
    expect(raised.map((entry) => [entry.position, entry.flop, entry.priority])).toEqual([
      [1, "Th6c2s", 6],
      [2, "Kd8s3h", 5],
      [3, "Qc9h4d", 3],
    ]);
    expect(FIXTURE_QUEUE[2]?.priority).toBe(1.5);
    expect(raiseToHead(FIXTURE_QUEUE, "missing")).toBe(FIXTURE_QUEUE);
  });

  it("R3.4 a queued flop request answers queued at position 1 and the next coverage read shows it first", () => {
    const route = createMockLibraryRoute();
    const body = { config_id: FIXTURE_QUEUE_CONFIG_ID, pair: FIXTURE_QUEUE_PAIR, flop: FIXTURE_REQUESTED_FLOP };
    const answer = route(request("POST", "/api/v1/coverage/requests", { body }), SIGNED_IN);
    expect(answer).toMatchObject({ status: 202, body: { status: "queued", queue_position: 1 } });
    const coverage = route(
      request("GET", "/api/v1/coverage", { query: { config_id: FIXTURE_QUEUE_CONFIG_ID, pair: FIXTURE_QUEUE_PAIR } }),
      SIGNED_IN,
    );
    expect((coverage?.body as { queue: { flop: string }[] }).queue[0]?.flop).toBe(FIXTURE_REQUESTED_FLOP);
  });

  it("R3.4 unknown spots, bad bodies, a missing CSRF token and a signed-out request are refused as the api does", () => {
    const route = createMockLibraryRoute();
    expect(route(request("GET", "/api/v1/coverage", { query: { config_id: "cfg_x", pair: "BB-BTN" } }), SIGNED_IN)?.status).toBe(404);
    expect(route(request("GET", "/api/v1/coverage"), SIGNED_IN)?.status).toBe(400);
    expect(route(request("POST", "/api/v1/coverage/requests", { body: { pair: 1 } }), SIGNED_IN)?.status).toBe(400);
    expect(route(request("POST", "/api/v1/coverage/requests", { headers: {} }), SIGNED_IN)?.status).toBe(403);
    expect(route(request("GET", "/api/v1/coverage"), { signedIn: false })?.status).toBe(401);
    expect(route(request("GET", "/api/v1/stakes"), SIGNED_IN)).toBeUndefined();
  });

  it("R3.5 the admin routes refuse a member, and pause, resume and a settings PATCH keep their state for an admin", () => {
    expect(createMockLibraryRoute({ admin: false })(request("GET", "/api/v1/admin/builder"), SIGNED_IN)?.status).toBe(403);
    const route = createMockLibraryRoute();
    expect(route(request("POST", "/api/v1/admin/builder/pause"), SIGNED_IN)?.body).toMatchObject({ state: "paused" });
    expect(route(request("GET", "/api/v1/admin/builder"), SIGNED_IN)?.body).toMatchObject({ state: "paused", settings: { paused: true } });
    expect(route(request("POST", "/api/v1/admin/builder/resume"), SIGNED_IN)?.body).toMatchObject({ state: "running" });
    const patched = route(request("PATCH", "/api/v1/admin/builder/settings", { body: { k_runouts: 30 } }), SIGNED_IN);
    expect(patched?.body).toEqual({ settings: { cpu_share: 0.6, paused: false, k_runouts: 30 } });
    expect(route(request("PATCH", "/api/v1/admin/builder/settings", { body: { poll: 1 } }), SIGNED_IN)?.status).toBe(400);
    expect(route(request("DELETE", "/api/v1/admin/builder"), SIGNED_IN)).toBeUndefined();
  });
});
