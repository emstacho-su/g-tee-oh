/**
 * GET /study/node and GET /study/insights over the fixture solver-query (R3.3, O-245, O-229,
 * ADR 0004): the root node relayed with its synthetic flag, a line walked through next_node_key,
 * node_key reads, the 404 and 400 problems, the next likely line prefetched so the follow-up read
 * reaches no solver-query node, and the pinned insights shape.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { studyInsightsSchema, studyNodeSchema } from "../src/schemas/study.js";
import { readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";
import { buildTrainerApp, countingFetch, fixtureSolverQuery } from "./support/solver-query.js";

const CONFIG = "cfg_6_online_100";
const PAIR = "BB-BTN";
const ROOT = `${CONFIG}/${PAIR}/`;
const UNCOVERED_CONFIG = "cfg_9_live_13_300";
const NODES_PATH = "/v1/nodes";
const STUDY_NODE = "/api/v1/study/node";

function nodeUrl(query: Record<string, string>): string {
  return `${STUDY_NODE}?${new URLSearchParams({ config_id: CONFIG, pair: PAIR, ...query }).toString()}`;
}

describe("R3.3 GET /study/node", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTrainerApp(database);
    await app.ready();
    const user = await createTestUser(database);
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it("R3.3 serves the pair's root from the fixture library with the synthetic flag (O-229)", async () => {
    const response = await app.inject({ method: "GET", url: nodeUrl({}), headers: readHeaders(session) });
    expect(response.statusCode).toBe(200);
    const body = studyNodeSchema.parse(response.json());
    expect(body.node_key).toBe(ROOT);
    expect(body).toMatchObject({ config_id: CONFIG, pair: PAIR, street: "preflop", synthetic: true });
    expect(body.hands.length).toBe(169);
    expect(body.actions.map((a) => a.token)).toContain("f");
  });

  it("R3.3 relays the numbers solver-query answers without recomputing them (ADR 0004)", async () => {
    const response = await app.inject({ method: "GET", url: nodeUrl({ hand: "AKs" }), headers: readHeaders(session) });
    const body = studyNodeSchema.parse(response.json());
    const coverage = await fixtureSolverQuery().GET("/v1/coverage", { params: { query: { config_id: CONFIG, pair: PAIR } } });
    const solutionId = coverage.data?.preflop.solution_ids[0] ?? "";
    const upstream = await fixtureSolverQuery().GET(NODES_PATH, {
      params: { query: { solution_id: solutionId, node_key: ROOT, hands: "AKs" } },
    });
    expect(body.solution_id).toBe(solutionId);
    expect(body.hands).toEqual(upstream.data?.hands.map((row) => ({ ...row, reach: row.reach ?? null })));
    expect(body.floor_pct_pot).toBe(upstream.data?.floor_pct_pot);
    expect(body.spot_class_key).toBe(upstream.data?.spot_class_key ?? null);
  });

  it("R3.3 walks a line through next_node_key and reads a node by node_key", async () => {
    const root = studyNodeSchema.parse(
      (await app.inject({ method: "GET", url: nodeUrl({}), headers: readHeaders(session) })).json(),
    );
    const opening = root.actions.find((a) => a.token !== "f");
    expect(opening).toBeDefined();
    const token = opening?.token ?? "";
    const walked = await app.inject({ method: "GET", url: nodeUrl({ line: token }), headers: readHeaders(session) });
    expect(walked.statusCode).toBe(200);
    const child = studyNodeSchema.parse(walked.json());
    expect(child.node_key).not.toBe(ROOT);
    const byKey = await app.inject({ method: "GET", url: nodeUrl({ node_key: child.node_key }), headers: readHeaders(session) });
    expect(byKey.statusCode).toBe(200);
    expect(studyNodeSchema.parse(byKey.json()).hands).toEqual(child.hands);
  });

  it("R3.3 a token the node does not offer, or a fold mid-line, is a 404 problem", async () => {
    const unknown = await app.inject({ method: "GET", url: nodeUrl({ line: "r9999" }), headers: readHeaders(session) });
    expect(unknown.statusCode).toBe(404);
    const folded = await app.inject({ method: "GET", url: nodeUrl({ line: "f.c" }), headers: readHeaders(session) });
    expect(folded.statusCode).toBe(404);
  });

  it("R3.3 a node_key outside the configuration and pair, or with a line, is a 400 problem", async () => {
    const outside = await app.inject({
      method: "GET",
      url: nodeUrl({ node_key: "cfg_6_online_150/BB-BTN/" }),
      headers: readHeaders(session),
    });
    expect(outside.statusCode).toBe(400);
    const both = await app.inject({ method: "GET", url: nodeUrl({ node_key: ROOT, line: "f" }), headers: readHeaders(session) });
    expect(both.statusCode).toBe(400);
  });

  it("R3.3 a configuration and pair with no preflop solution is a 404 problem", async () => {
    const response = await app.inject({
      method: "GET",
      url: nodeUrl({ config_id: UNCOVERED_CONFIG }),
      headers: readHeaders(session),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      detail: "the library holds no preflop solution for this configuration and pair",
    });
  });

  it("R3.3 needs a session", async () => {
    const response = await app.inject({ method: "GET", url: nodeUrl({}) });
    expect(response.statusCode).toBe(401);
  });
});

describe("R3.3 study prefetch: the next likely node", () => {
  it("R3.3 the next likely line is null when the likeliest action ends the solution", async () => {
    const database = appDatabase();
    const app = buildTrainerApp(database);
    try {
      await app.ready();
      const user = await createTestUser(database);
      const session = await createTestSession(database, user.id);
      // At the 6-max synthetic root the fold share is the larger one, and a fold has no child node.
      const root = studyNodeSchema.parse(
        (await app.inject({ method: "GET", url: nodeUrl({}), headers: readHeaders(session) })).json(),
      );
      expect(root.next_likely_line).toBeNull();
      expect(root.next_likely_node_key).toBeNull();
    } finally {
      await app.close();
      await database.destroy();
    }
  });

  it("R3.3 the second request for the prefetched node reads no node from solver-query", async () => {
    const database = appDatabase();
    const counting = countingFetch();
    const app = buildTrainerApp(database, { solverQuery: fixtureSolverQuery(counting.fetch) });
    try {
      await app.ready();
      const user = await createTestUser(database);
      const session = await createTestSession(database, user.id);
      // The heads-up push/fold root: all-in is the larger share at 10bb, so the prefetched child exists.
      const pushFold = { config_id: "cfg_2_online_norake_10", pair: PAIR };
      const url = (query: Record<string, string>) =>
        `${STUDY_NODE}?${new URLSearchParams({ ...pushFold, ...query }).toString()}`;
      const first = studyNodeSchema.parse(
        (await app.inject({ method: "GET", url: url({}), headers: readHeaders(session) })).json(),
      );
      expect(first.next_likely_line).toBe("a");
      expect(first.next_likely_node_key).toBe("cfg_2_online_norake_10/BB-BTN/a");
      const before = counting.calls.filter((path) => path === NODES_PATH).length;
      const second = await app.inject({ method: "GET", url: url({ line: "a" }), headers: readHeaders(session) });
      expect(second.statusCode).toBe(200);
      expect(studyNodeSchema.parse(second.json()).node_key).toBe("cfg_2_online_norake_10/BB-BTN/a");
      expect(counting.calls.filter((path) => path === NODES_PATH).length).toBe(before);
    } finally {
      await app.close();
      await database.destroy();
    }
  });
});

describe("R3.3 GET /study/insights", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTrainerApp(database);
    await app.ready();
    const user = await createTestUser(database);
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it("R3.3 relays solver-query's insights in the pinned shape", async () => {
    const coverage = await fixtureSolverQuery().GET("/v1/coverage", { params: { query: { config_id: CONFIG, pair: PAIR } } });
    const solutionId = coverage.data?.preflop.solution_ids[0] ?? "";
    const query = new URLSearchParams({ solution_id: solutionId, node_key: ROOT, hand: "AKs" }).toString();
    const response = await app.inject({ method: "GET", url: `/api/v1/study/insights?${query}`, headers: readHeaders(session) });
    expect(response.statusCode).toBe(200);
    const body = studyInsightsSchema.parse(response.json());
    expect(body.blockers.hand).toBe("AKs");
    expect(body.threshold_card?.hand_position.hand).toBe("AKs");
    expect(body.equity_distribution?.bin_edges.length).toBeGreaterThan(0);
    expect(body.hand_role).toBe("value");
  });

  it("R3.3 an unknown solution is a 404 problem", async () => {
    const query = new URLSearchParams({
      solution_id: "00000000-0000-7000-8000-000000000000",
      node_key: ROOT,
      hand: "AKs",
    }).toString();
    const response = await app.inject({ method: "GET", url: `/api/v1/study/insights?${query}`, headers: readHeaders(session) });
    expect(response.statusCode).toBe(404);
  });
});
