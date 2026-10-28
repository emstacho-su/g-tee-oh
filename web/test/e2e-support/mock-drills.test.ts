/**
 * The mocked drill routes (S26, R3.14, O-264, O-310, O-311) answer as the api does, so the
 * component tests, the shots and the mocked flow 2 exercise real behavior: CRUD scoped to the
 * mock's own store, the tag filter and cursor pages, the 409 for a drill in use, export codes in
 * the "gteeoh1." format and imports of them, Idempotency-Key replay, 400 problems with field
 * errors, 401 signed out and 403 without the CSRF token.
 */
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { MockRequest } from "../../e2e/support/mock-api.js";
import { createMockDrillRoute, MOCK_DRILL_PATHS, SEEDED_DRILLS } from "../../e2e/support/mock-drills.js";
import type { Drill, DrillCreate } from "../../src/drills/types.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import { FIXTURE_DRILL_ID, FIXTURE_UNCOVERED_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";

const SIGNED_IN = { signedIn: true };

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: { "x-csrf-token": FIXTURE_CSRF_TOKEN }, body: undefined, ...init };
}

const NEW_DRILL: DrillCreate = {
  name: "RFI boundary hands",
  tags: ["rfi"],
  spot_filter: { ...fixtureDrill.spot_filter, villain_positions: [], hands: { mode: "close_decisions" } },
  trainer: fixtureDrill.trainer,
};

function codeOf(payload: unknown): string {
  return `gteeoh1.${deflateSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64url")}`;
}

describe("R3.14 mocked drill routes", () => {
  it("R3.14 the list holds the fixture drills newest first, filters by tag and pages with a cursor", () => {
    const route = createMockDrillRoute();
    const all = route(request("GET", MOCK_DRILL_PATHS.list), SIGNED_IN);
    const ids = (all?.body as { items: Drill[] }).items.map((drill) => drill.id);
    expect(ids).toEqual([...SEEDED_DRILLS].reverse().map((drill) => drill.id));
    expect(ids[0]).toBe(FIXTURE_UNCOVERED_DRILL_ID);
    const created = route(request("POST", MOCK_DRILL_PATHS.list, { body: NEW_DRILL }), SIGNED_IN);
    expect(created?.status).toBe(201);
    const tagged = route(request("GET", MOCK_DRILL_PATHS.list, { query: { tag: "rfi" } }), SIGNED_IN);
    expect((tagged?.body as { items: Drill[] }).items.map((drill) => drill.name)).toEqual(["RFI boundary hands"]);
    const first = route(request("GET", MOCK_DRILL_PATHS.list, { query: { limit: "5" } }), SIGNED_IN)?.body as { items: Drill[]; next_cursor: string | null };
    expect(first.items).toHaveLength(5);
    expect(first.next_cursor).not.toBeNull();
    const second = route(request("GET", MOCK_DRILL_PATHS.list, { query: { limit: "5", cursor: first.next_cursor ?? "" } }), SIGNED_IN)?.body as { items: Drill[]; next_cursor: string | null };
    expect(second.items.map((drill) => drill.id)).toEqual([FIXTURE_DRILL_ID]);
    expect(second.next_cursor).toBeNull();
    expect(route(request("GET", MOCK_DRILL_PATHS.list, { query: { tag: "Bad Tag" } }), SIGNED_IN)?.status).toBe(400);
    expect(route(request("GET", MOCK_DRILL_PATHS.list, { query: { cursor: "nope" } }), SIGNED_IN)?.status).toBe(400);
  });

  it("R3.14 create, read, patch and delete; drillOf sees the store; a drill in use answers 409", () => {
    const route = createMockDrillRoute();
    const created = route(request("POST", MOCK_DRILL_PATHS.list, { body: NEW_DRILL }), SIGNED_IN)?.body as Drill;
    expect(route.drillOf(created.id)).toEqual(created);
    expect(route(request("GET", `${MOCK_DRILL_PATHS.list}/${created.id}`), SIGNED_IN)?.body).toEqual(created);
    const patched = route(request("PATCH", `${MOCK_DRILL_PATHS.list}/${created.id}`, { body: { name: "Renamed" } }), SIGNED_IN);
    expect(patched?.body).toMatchObject({ id: created.id, name: "Renamed", tags: ["rfi"] });
    expect(route(request("PATCH", `${MOCK_DRILL_PATHS.list}/${created.id}`, { body: {} }), SIGNED_IN)?.status).toBe(400);
    expect(route(request("DELETE", `${MOCK_DRILL_PATHS.list}/${created.id}`), SIGNED_IN)?.status).toBe(204);
    expect(route.drillOf(created.id)).toBeUndefined();
    expect(route(request("GET", `${MOCK_DRILL_PATHS.list}/${created.id}`), SIGNED_IN)?.status).toBe(404);
    const inUse = route(request("DELETE", `${MOCK_DRILL_PATHS.list}/${FIXTURE_DRILL_ID}`), SIGNED_IN);
    expect(inUse).toMatchObject({ status: 409, body: { type: "urn:g-tee-oh:problem:conflict" } });
  });

  it("R3.14 a body breaking the write rules is a 400 with field errors at body paths", () => {
    const route = createMockDrillRoute();
    const bad = { ...NEW_DRILL, spot_filter: { ...NEW_DRILL.spot_filter, stake: "1/3", hero_positions: ["LJ"] } };
    const answer = route(request("POST", MOCK_DRILL_PATHS.list, { body: bad }), SIGNED_IN);
    expect(answer?.status).toBe(400);
    expect((answer?.body as { errors: { path: string }[] }).errors.map((error) => error.path)).toEqual([
      "body.spot_filter.stake",
      "body.spot_filter.hero_positions.0",
    ]);
    expect(route(request("POST", MOCK_DRILL_PATHS.list, { body: { name: 3 } }), SIGNED_IN)?.status).toBe(400);
    expect(route(request("POST", MOCK_DRILL_PATHS.list, { body: "text" }), SIGNED_IN)?.status).toBe(400);
  });

  it("R3.14 O-310 an export code imports as a new drill with the same name, tags, filter and trainer settings", () => {
    const route = createMockDrillRoute();
    const exported = route(request("GET", `${MOCK_DRILL_PATHS.list}/${FIXTURE_DRILL_ID}/export`), SIGNED_IN)?.body as { export_code: string };
    expect(exported.export_code.startsWith("gteeoh1.")).toBe(true);
    const imported = route(request("POST", MOCK_DRILL_PATHS.import, { body: { export_code: exported.export_code } }), SIGNED_IN);
    expect(imported?.status).toBe(201);
    const drill = imported?.body as Drill;
    expect(drill.id).not.toBe(FIXTURE_DRILL_ID);
    expect({ name: drill.name, tags: drill.tags, spot_filter: drill.spot_filter, trainer: drill.trainer }).toEqual({
      name: fixtureDrill.name,
      tags: fixtureDrill.tags,
      spot_filter: fixtureDrill.spot_filter,
      trainer: fixtureDrill.trainer,
    });
    expect(route(request("GET", `${MOCK_DRILL_PATHS.list}/missing/export`), SIGNED_IN)?.status).toBe(404);
  });

  it.each([
    ["another version", "gteeoh2.abc", "does not start with gteeoh1."],
    ["a damaged code", "gteeoh1.!!!", "damaged"],
    ["a code that is not zlib", "gteeoh1.YWJjZA", "damaged"],
    ["a code over the length limit", `gteeoh1.${"a".repeat(8200)}`, "longer than 8192"],
  ])("R3.14 O-310 importing %s is a 400 naming why", (_name, code, detail) => {
    const route = createMockDrillRoute();
    const answer = route(request("POST", MOCK_DRILL_PATHS.import, { body: { export_code: code } }), SIGNED_IN);
    expect(answer?.status).toBe(400);
    expect((answer?.body as { detail: string }).detail).toContain(detail);
    expect((answer?.body as { errors: { path: string }[] }).errors[0]?.path).toBe("body.export_code");
  });

  it("R3.14 O-310 a code holding a drill the write rules refuse is a 400 with the payload's paths", () => {
    const route = createMockDrillRoute();
    const code = codeOf({ ...NEW_DRILL, spot_filter: { ...NEW_DRILL.spot_filter, stake: "1/3" } });
    const answer = route(request("POST", MOCK_DRILL_PATHS.import, { body: { export_code: code } }), SIGNED_IN);
    expect(answer?.status).toBe(400);
    expect((answer?.body as { errors: { path: string }[] }).errors.map((error) => error.path)).toEqual(["body.export_code.spot_filter.stake"]);
    expect(route(request("POST", MOCK_DRILL_PATHS.import, { body: { code } }), SIGNED_IN)?.status).toBe(400);
  });

  it("R3.14 O-232 a repeat with the same Idempotency-Key replays the first answer and writes once", () => {
    const route = createMockDrillRoute();
    const headers = { "x-csrf-token": FIXTURE_CSRF_TOKEN, "idempotency-key": "key-1" };
    const first = route(request("POST", MOCK_DRILL_PATHS.list, { body: NEW_DRILL, headers }), SIGNED_IN);
    const again = route(request("POST", MOCK_DRILL_PATHS.list, { body: NEW_DRILL, headers }), SIGNED_IN);
    expect(again).toEqual(first);
    const list = route(request("GET", MOCK_DRILL_PATHS.list), SIGNED_IN)?.body as { items: Drill[] };
    expect(list.items).toHaveLength(SEEDED_DRILLS.length + 1);
  });

  it("R3.14 signed out is 401, a write without the CSRF token is 403, and other paths are not ours", () => {
    const route = createMockDrillRoute();
    expect(route(request("GET", MOCK_DRILL_PATHS.list), { signedIn: false })?.status).toBe(401);
    expect(route(request("POST", MOCK_DRILL_PATHS.list, { body: NEW_DRILL, headers: {} }), SIGNED_IN)?.status).toBe(403);
    expect(route(request("DELETE", `${MOCK_DRILL_PATHS.list}/${FIXTURE_DRILL_ID}`, { headers: {} }), SIGNED_IN)?.status).toBe(403);
    expect(route(request("POST", "/api/v1/sessions"), SIGNED_IN)).toBeUndefined();
    expect(route(request("PUT", MOCK_DRILL_PATHS.list), SIGNED_IN)).toBeUndefined();
  });
});
