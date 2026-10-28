// Tests for e2e/support/mock-study.ts (S25, R3.12, O-264): the mocked catalog and study routes the
// shots project uses. The route is a pure function, so these call it directly with no browser.
import { describe, expect, it } from "vitest";

import { createMockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { mockStudyRoute } from "../../e2e/support/mock-study.js";
import {
  FIXTURE_CHILD_LINE,
  FIXTURE_LIVE_STAKE_ID,
  FIXTURE_OUT_OF_RANGE_HAND,
  FIXTURE_STUDY_CONFIG_ID,
  FIXTURE_STUDY_PAIR,
  fixtureChildNode,
  fixtureConfigs,
  fixturePairsByConfig,
  fixtureRootNode,
  fixtureStakes,
} from "../../src/fixtures/study.js";

const SIGNED_IN = { signedIn: true };
const JSON_TYPE = "application/json";
const PROBLEM_JSON = "application/problem+json";

function get(path: string, query: Record<string, string> = {}): MockRequest {
  return { method: "GET", path, query, headers: {}, body: undefined };
}

const NODE_QUERY = { config_id: FIXTURE_STUDY_CONFIG_ID, pair: FIXTURE_STUDY_PAIR };

describe("R3.12 mock study routes", () => {
  it("R3.12 every study and catalog path answers a 401 problem when signed out", () => {
    for (const path of ["/api/v1/stakes", "/api/v1/configs", "/api/v1/configs/cfg_6_online_100/pairs", "/api/v1/study/node", "/api/v1/study/insights"]) {
      const response = mockStudyRoute(get(path), { signedIn: false });
      expect(response?.status).toBe(401);
      expect(response?.contentType).toBe(PROBLEM_JSON);
    }
  });

  it("R3.12 leaves other paths and methods to the next route", () => {
    expect(mockStudyRoute(get("/api/v1/drills/x"), SIGNED_IN)).toBeUndefined();
    expect(mockStudyRoute({ ...get("/api/v1/stakes"), method: "POST" }, SIGNED_IN)).toBeUndefined();
  });

  it("R3.12 GET /stakes lists the fixture stakes, filtered by format when asked", () => {
    expect(mockStudyRoute(get("/api/v1/stakes"), SIGNED_IN)).toEqual({
      status: 200,
      contentType: JSON_TYPE,
      body: { items: fixtureStakes, next_cursor: null },
    });
    const live = mockStudyRoute(get("/api/v1/stakes", { format: "live" }), SIGNED_IN);
    expect((live?.body as { items: unknown[] }).items).toHaveLength(2);
  });

  it("R3.12 GET /configs filters by format, table size and stake", () => {
    const online = mockStudyRoute(get("/api/v1/configs", { format: "online" }), SIGNED_IN);
    expect((online?.body as { items: unknown[] }).items).toHaveLength(2);
    const live = mockStudyRoute(get("/api/v1/configs", { table_size: "9", stake_id: FIXTURE_LIVE_STAKE_ID }), SIGNED_IN);
    expect(live?.body).toEqual({ items: [fixtureConfigs[2]], next_cursor: null });
  });

  it("R3.12 GET /configs/{id}/pairs lists the pairs, and an unknown configuration is a 404 problem", () => {
    const pairs = mockStudyRoute(get(`/api/v1/configs/${FIXTURE_STUDY_CONFIG_ID}/pairs`), SIGNED_IN);
    expect(pairs?.body).toEqual({ items: fixturePairsByConfig[FIXTURE_STUDY_CONFIG_ID], next_cursor: null });
    expect(mockStudyRoute(get("/api/v1/configs/cfg_none/pairs"), SIGNED_IN)?.status).toBe(404);
  });

  it("R3.12 GET /study/node answers the root and the child by line, and 404 for an unknown node", () => {
    expect(mockStudyRoute(get("/api/v1/study/node", NODE_QUERY), SIGNED_IN)?.body).toEqual(fixtureRootNode);
    const child = mockStudyRoute(get("/api/v1/study/node", { ...NODE_QUERY, line: FIXTURE_CHILD_LINE }), SIGNED_IN);
    expect(child?.body).toEqual(fixtureChildNode);
    const unknown = mockStudyRoute(get("/api/v1/study/node", { ...NODE_QUERY, line: "f" }), SIGNED_IN);
    expect(unknown?.status).toBe(404);
    expect(unknown?.body).toMatchObject({ type: "urn:g-tee-oh:problem:not-found" });
  });

  it("R3.12 GET /study/node without config_id or pair is a 400 validation problem", () => {
    expect(mockStudyRoute(get("/api/v1/study/node", { pair: FIXTURE_STUDY_PAIR }), SIGNED_IN)?.status).toBe(400);
  });

  it("R3.12 GET /study/insights answers the hand's insights, hand-not-in-range, and 400 without a hand", () => {
    const query = { solution_id: fixtureRootNode.solution_id, node_key: fixtureRootNode.node_key };
    const insights = mockStudyRoute(get("/api/v1/study/insights", { ...query, hand: "AKs" }), SIGNED_IN);
    expect(insights?.status).toBe(200);
    expect(insights?.body).toMatchObject({ threshold_card: { hand_position: { hand: "AKs" } } });
    const gone = mockStudyRoute(get("/api/v1/study/insights", { ...query, hand: FIXTURE_OUT_OF_RANGE_HAND }), SIGNED_IN);
    expect(gone?.status).toBe(404);
    expect(gone?.body).toMatchObject({ type: "urn:g-tee-oh:problem:hand-not-in-range" });
    expect(mockStudyRoute(get("/api/v1/study/insights", query), SIGNED_IN)?.status).toBe(400);
    const unknownNode = mockStudyRoute(get("/api/v1/study/insights", { ...query, node_key: "nope", hand: "AKs" }), SIGNED_IN);
    expect(unknownNode?.status).toBe(404);
  });

  it("R3.12 composes into createMockApi behind the auth routes", () => {
    const api = createMockApi({ routes: [mockStudyRoute] });
    expect(api.handle(get("/api/v1/stakes")).status).toBe(401);
  });
});
