/**
 * GET /progress/frequencies (R4.12, S41, O-353, O-417, O-418): your preflop action frequencies against
 * the solver's, per node and hand class, over the real fixture solver-query (cfg_6_online_100 BB-BTN).
 *
 * Attempt rows are inserted through the superuser pool at the fixture node r250 (the big blind facing
 * the button's open), each storing the node row's own strategy as freq_by_action, as grading does.
 * Covered: the pooled comparison shows from 30 decisions and a hand class row from 10; the numbers are
 * the share of the user's choices and the mean stored solver frequency; holdout, client-seeded,
 * answer-revealing-panel and non-preflop decisions never count; another user's decisions never
 * count (owner scoping); labels, seat and family come from the node read; a node the library no
 * longer holds is left out; only the 12 most played nodes are listed; 401 without a session.
 */

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { frequencyComparisonSchema, MAX_FREQUENCY_SPOTS, MIN_HAND_DECISIONS, MIN_SPOT_DECISIONS } from "../src/schemas/frequencies.js";
import type { SqNode } from "../src/solver-query/client.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";
import { insertSolution, newPlayer, type Player } from "./sessions-test-kit.js";

const FIXTURE_SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const CONFIG = "cfg_6_online_100";
const PAIR = "BB-BTN";
const DEFEND_NODE = "cfg_6_online_100/BB-BTN/r250";
const OPEN_NODE = "cfg_6_online_100/BB-BTN/";
const PATH = "/api/v1/progress/frequencies";
const CLOSE = 1e-6;

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
let defend: SqNode;
let open: SqNode;

async function nodeOf(nodeKey: string): Promise<SqNode> {
  const { data } = await fixtureSolverQuery().GET("/v1/nodes", { params: { query: { solution_id: FIXTURE_SOLUTION_ID, node_key: nodeKey } } });
  if (data === undefined) throw new Error(`no fixture node ${nodeKey}`);
  return data;
}

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  await insertSolution(pool, CONFIG, PAIR, FIXTURE_SOLUTION_ID);
  app = buildTrainerApp(database);
  await app.ready();
  defend = await nodeOf(DEFEND_NODE);
  open = await nodeOf(OPEN_NODE);
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

interface SessionKind {
  mode?: string;
  seeded?: boolean;
}

async function sessionFor(player: Player, kind: SessionKind = {}): Promise<string> {
  const state = JSON.stringify({ seeded: kind.seeded ?? false });
  const result = await pool.query<{ id: string }>(
    "insert into practice_session (user_id, mode, settings, state) values ($1, $2, '{}'::jsonb, $3::jsonb) returning id",
    [player.userId, kind.mode ?? "drill", state],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("no session row");
  return id;
}

interface Decisions {
  node: SqNode;
  hand: string;
  actionIndex: number;
  count: number;
  panels?: boolean;
  spotClassKey?: string;
  nodeKey?: string;
}

function strategyOf(node: SqNode, hand: string): number[] {
  const row = node.hands.find((entry) => entry.hand === hand);
  if (row === undefined) throw new Error(`no row ${hand} at ${node.node_key}`);
  return [...row.strategy];
}

async function insertDecisions(player: Player, sessionId: string, decisions: Decisions): Promise<void> {
  const { node, hand, actionIndex, count } = decisions;
  await pool.query(
    `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, hand_class, action_index,
       action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight,
       freq_by_action, action_kinds, panels_revealed)
     select $1, $2, $3, $4, $5, '{}', $6, $6, $7, 'x', 0, 0, 0, 0, 0.5, 1, 'best', false, 1, $8::real[], $9::text[], $10
     from generate_series(1, $11::int)`,
    [
      player.userId,
      sessionId,
      FIXTURE_SOLUTION_ID,
      decisions.nodeKey ?? node.node_key,
      decisions.spotClassKey ?? node.spot_class_key,
      hand,
      actionIndex,
      strategyOf(node, hand),
      node.actions.map((action) => action.kind),
      decisions.panels ?? false,
      count,
    ],
  );
}

async function read(player: Player) {
  const response = await app.inject({ method: "GET", url: PATH, headers: player.read });
  expect(response.statusCode, response.body).toBe(200);
  expect(contractErrors("get", PATH, 200, response.json())).toEqual([]);
  return frequencyComparisonSchema.parse(response.json());
}

/** The owner's counted decisions at r250: AKs 6 calls and 6 raises, QJs 10 calls, 72o 9 folds (31 in all). */
async function seedOwner(owner: Player): Promise<void> {
  const counted = await sessionFor(owner);
  await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 1, count: 6 });
  await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 2, count: 6 });
  await insertDecisions(owner, counted, { node: defend, hand: "QJs", actionIndex: 1, count: 10 });
  await insertDecisions(owner, counted, { node: defend, hand: "72o", actionIndex: 0, count: 9 });
  await insertDecisions(owner, counted, { node: open, hand: "AKs", actionIndex: 2, count: 5 });
}

function mean(rows: ReadonlyArray<[number[], number]>, index: number): number {
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return rows.reduce((sum, [strategy, count]) => sum + (strategy[index] ?? 0) * count, 0) / total;
}

describe("R4.12 GET /progress/frequencies", () => {
  it("R4.12 compares your frequency with the solver's per node and hand class, from the minimum samples (O-417)", async () => {
    const owner = await newPlayer(database);
    await seedOwner(owner);
    const view = await read(owner);
    expect(view).toMatchObject({ min_spot_decisions: MIN_SPOT_DECISIONS, min_hand_decisions: MIN_HAND_DECISIONS });
    expect([MIN_SPOT_DECISIONS, MIN_HAND_DECISIONS]).toEqual([30, 10]);
    expect(view.spots.map((spot) => [spot.node_key, spot.decisions])).toEqual([
      [DEFEND_NODE, 31],
      [OPEN_NODE, 5],
    ]);
    const [spot, below] = view.spots;
    expect(spot).toMatchObject({ config_id: CONFIG, pair: PAIR, hero_position: "BB", spot_class_key: defend.spot_class_key });
    expect(spot?.action_family).toBe(defend.action_family ?? null);
    expect(spot?.actions).toEqual(defend.actions.map((action) => ({ index: action.index, label: action.label, kind: action.kind })));
    expect(spot?.pooled?.your_freq).toEqual([9 / 31, 16 / 31, 6 / 31].map((value) => expect.closeTo(value, 6)));
    const pooledRows: Array<[number[], number]> = [
      [strategyOf(defend, "AKs"), 12],
      [strategyOf(defend, "QJs"), 10],
      [strategyOf(defend, "72o"), 9],
    ];
    spot?.pooled?.solver_freq.forEach((value, index) => expect(Math.abs(value - mean(pooledRows, index))).toBeLessThan(CLOSE));
    expect(spot?.hands.map((hand) => hand.hand_class).sort()).toEqual(["AKs", "QJs"]);
    const aks = spot?.hands.find((hand) => hand.hand_class === "AKs");
    expect(aks).toMatchObject({ decisions: 12, your_freq: [0, 0.5, 0.5] });
    aks?.solver_freq.forEach((value, index) => expect(Math.abs(value - (strategyOf(defend, "AKs")[index] ?? 0))).toBeLessThan(CLOSE));
    const gaps = spot?.hands.map((hand) => hand.your_freq.reduce((sum, yours, index) => sum + Math.abs(yours - (hand.solver_freq[index] ?? 0)), 0)) ?? [];
    expect(gaps, "the largest gap first").toEqual([...gaps].sort((a, b) => b - a));
    expect(below).toMatchObject({ decisions: 5, pooled: null, hands: [], hero_position: "BTN" });
  });

  it("R4.12 holdout, client-seeded, answer-revealing-panel and non-preflop decisions never count (O-418)", async () => {
    const owner = await newPlayer(database);
    await seedOwner(owner);
    const baseline = await read(owner);
    await insertDecisions(owner, await sessionFor(owner, { mode: "holdout" }), { node: defend, hand: "AKs", actionIndex: 0, count: 7 });
    await insertDecisions(owner, await sessionFor(owner, { seeded: true }), { node: defend, hand: "AKs", actionIndex: 0, count: 7 });
    const counted = await sessionFor(owner);
    await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 0, count: 7, panels: true });
    await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 0, count: 40, spotClassKey: "unclassified" });
    expect(await read(owner)).toEqual(baseline);
  });

  it("R4.12 another user's decisions never count, and each user reads only their own (owner scoping)", async () => {
    const owner = await newPlayer(database);
    await seedOwner(owner);
    const baseline = await read(owner);
    const other = await newPlayer(database);
    await insertDecisions(other, await sessionFor(other), { node: defend, hand: "AKs", actionIndex: 0, count: 60 });
    expect(await read(owner)).toEqual(baseline);
    const theirs = await read(other);
    expect(theirs.spots.map((spot) => [spot.node_key, spot.decisions])).toEqual([[DEFEND_NODE, 60]]);
    const stranger = await newPlayer(database);
    expect((await read(stranger)).spots).toEqual([]);
  });

  it("R4.12 a node the library no longer holds is left out, and only the 12 most played nodes are listed (O-418)", async () => {
    const owner = await newPlayer(database);
    const counted = await sessionFor(owner);
    await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 1, count: 31 });
    await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 1, count: 40, nodeKey: `${DEFEND_NODE}.c` });
    expect((await read(owner)).spots.map((spot) => spot.node_key)).toEqual([DEFEND_NODE]);
    for (let gone = 0; gone < MAX_FREQUENCY_SPOTS; gone += 1) {
      await insertDecisions(owner, counted, { node: defend, hand: "AKs", actionIndex: 1, count: 50, nodeKey: `${DEFEND_NODE}.r${gone + 900}` });
    }
    expect((await read(owner)).spots, "r250 is the 13th most played node now").toEqual([]);
  });

  it("R4.12 needs a session (401)", async () => {
    const response = await app.inject({ method: "GET", url: PATH });
    expect(response.statusCode).toBe(401);
  });
});
