/**
 * GET /insights/drift (R3.18, O-304, 05 section 9): range drift over the session user's own
 * attempts in one node family. Attempt rows are inserted directly through the superuser pool with
 * the S23 columns plus action_kinds (a drill session over the fake solver-query supplies the
 * practice_session row the foreign key needs), so the tests fix the decision count exactly:
 * hidden at 29 and shown at 30, another user's rows never count, rows without action_kinds are
 * excluded, and reading drift changes no score, rated flag, weight or label. Drift is no input of
 * grading: buildGradeInput's keys name nothing drift related.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { buildGradeInput } from "../src/grading/policy.js";
import { DRIFT_DECISIONS_CAP, toDriftDecision } from "../src/insights/drift.js";
import { driftSchema } from "../src/schemas/explain.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer, startSession, trainerApp, type Player, TRAINER } from "./sessions-test-kit.js";
import { flaggedGrade, policyNode } from "./R3.18-support.js";

const DRIFT_PATH = "/api/v1/insights/drift";
const KINDS = ["fold", "call", "raise"] as const;

let database: Database;
let pool: pg.Pool;
let solutionId: string;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

async function setUp() {
  const sq = fakeSolverQuery({ solutionId });
  const app = trainerApp(database, sq.client);
  await app.ready();
  const player = await newPlayer(database);
  const drillId = await createDrill(app, player, drillBody());
  const sessionId = await startSession(app, player, drillId);
  return { app, player, sessionId };
}

type App = Awaited<ReturnType<typeof setUp>>["app"];

interface DriftRow {
  actionIndex: number;
  kinds: readonly string[] | null;
  freqs: readonly number[] | null;
}

/** Inserts attempt rows for one user's session in one spot class, state versions from `firstVersion`. */
async function insertAttempts(userId: string, sessionId: string, spotClassKey: string, rows: readonly DriftRow[], firstVersion = 0): Promise<void> {
  for (const [offset, row] of rows.entries()) {
    await pool.query(
      `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, action_index,
         action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight,
         state_version, freq_by_action, action_kinds)
       values ($1, $2, $3, 'test/node', $4, '{}', 'AKo', $5, 'x', 0, 0, 0, 0, 0.5, $6, 'best', $7, $8, $9, $10, $11)`,
      [userId, sessionId, solutionId, spotClassKey, row.actionIndex, 0.75, offset % 2 === 0, 0.5, firstVersion + offset, row.freqs, row.kinds],
    );
  }
}

/** n decisions cycling call (freqs 0, 0.5, 0.5), fold (1, 0, 0) and call (0, 0, 1): drift distance one half. */
function handSet(count: number): DriftRow[] {
  const cycle: DriftRow[] = [
    { actionIndex: 1, kinds: KINDS, freqs: [0, 0.5, 0.5] },
    { actionIndex: 0, kinds: KINDS, freqs: [1, 0, 0] },
    { actionIndex: 1, kinds: KINDS, freqs: [0, 0, 1] },
  ];
  return Array.from({ length: count }, (_, index) => cycle[index % cycle.length] as DriftRow);
}

function getDrift(app: App, player: Player, spotClassKey: string) {
  return app.inject({ method: "GET", url: `${DRIFT_PATH}?spot_class_key=${encodeURIComponent(spotClassKey)}`, headers: player.read });
}

function spotClass(): string {
  return `test/drift/${randomUUID()}`;
}

describe("R3.18 GET /insights/drift visibility", () => {
  it("R3.18 drift is hidden at 29 decisions and shown at 30, both contract clean", async () => {
    const { app, player, sessionId } = await setUp();
    const key = spotClass();
    await insertAttempts(player.userId, sessionId, key, handSet(29));
    const hidden = await getDrift(app, player, key);
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(contractErrors("get", "/api/v1/insights/drift", 200, hidden.json())).toEqual([]);
    expect(driftSchema.parse(hidden.json())).toEqual({
      spot_class_key: key,
      decisions: 29,
      min_decisions: 30,
      shown: false,
      distance: null,
      ci_low: null,
      ci_high: null,
      confidence: 0.95,
      by_kind: [],
    });
    await insertAttempts(player.userId, sessionId, key, handSet(30).slice(29), 29);
    const shown = await getDrift(app, player, key);
    expect(contractErrors("get", "/api/v1/insights/drift", 200, shown.json())).toEqual([]);
    const body = driftSchema.parse(shown.json());
    expect(body).toMatchObject({ decisions: 30, shown: true, min_decisions: 30 });
    expect(body.distance).toBeCloseTo(0.5, 9);
    expect(body.ci_low).toBeLessThanOrEqual(body.distance ?? Number.NaN);
    expect(body.ci_high).toBeGreaterThanOrEqual(body.distance ?? Number.NaN);
    expect(body.by_kind.map((row) => row.kind)).toEqual(["fold", "call", "raise"]);
    expect(body.by_kind[1]?.user_share).toBeCloseTo(2 / 3, 9);
    expect(body.by_kind[1]?.solver_share).toBeCloseTo(1 / 6, 9);
    await app.close();
  });

  it("R3.18 another user's attempts never count, and rows without action_kinds are excluded", async () => {
    const owner = await setUp();
    const other = await setUp();
    const key = spotClass();
    await insertAttempts(other.player.userId, other.sessionId, key, handSet(40));
    await insertAttempts(owner.player.userId, owner.sessionId, key, handSet(5));
    await insertAttempts(owner.player.userId, owner.sessionId, key, [{ actionIndex: 0, kinds: null, freqs: [1, 0, 0] }], 5);
    const response = await getDrift(owner.app, owner.player, key);
    expect(driftSchema.parse(response.json())).toMatchObject({ decisions: 5, shown: false });
    const unrelated = await getDrift(owner.app, owner.player, spotClass());
    expect(driftSchema.parse(unrelated.json())).toMatchObject({ decisions: 0, shown: false });
    await owner.app.close();
    await other.app.close();
  });

  it("R3.18 caps the decisions read at a named limit", () => {
    expect(DRIFT_DECISIONS_CAP).toBe(2000);
  });

  it("R3.18 a stored row grading could not have written is a 500 naming no row content", () => {
    const rows = [
      { action_index: 0, action_kinds: ["fold", "call"], freq_by_action: [1] },
      { action_index: 2, action_kinds: ["fold", "call"], freq_by_action: [1, 0] },
      { action_index: 0, action_kinds: ["fold", "jam"], freq_by_action: [1, 0] },
    ];
    for (const row of rows) {
      expect(() => toDriftDecision(row)).toThrow(expect.objectContaining({ status: 500, detail: "A stored attempt cannot be read for range drift." }));
    }
    expect(toDriftDecision({ action_index: 1, action_kinds: ["fold", "call"], freq_by_action: [0.4, 0.6] })).toEqual({
      chosenKind: "call",
      kinds: ["fold", "call"],
      freqByAction: [0.4, 0.6],
    });
  });
});

describe("R3.18 drift changes no score", () => {
  it("R3.18 every attempt's score, rated, weight and label are identical before and after reading drift", async () => {
    const { app, player, sessionId } = await setUp();
    const key = spotClass();
    await insertAttempts(player.userId, sessionId, key, handSet(30));
    const snapshot = async (): Promise<unknown[]> => {
      const result = await pool.query<Record<string, unknown>>("select id, score, rated, weight, label from attempt where user_id = $1 order by id", [player.userId]);
      return result.rows;
    };
    const before = await snapshot();
    const response = await getDrift(app, player, key);
    expect(driftSchema.parse(response.json()).shown).toBe(true);
    expect(await snapshot()).toEqual(before);
    await app.close();
  });

  it("R3.18 drift is no input of grade(): buildGradeInput's keys name nothing drift related", () => {
    const input = buildGradeInput({
      node: policyNode(),
      grade: flaggedGrade([]),
      actionIndex: 1,
      rngRoll: null,
      settings: TRAINER,
      ratedTodayInTrack: 0,
      mode: "automated",
    });
    expect(Object.keys(input).filter((key) => /drift|share|distance/i.test(key))).toEqual([]);
  });
});

describe("R3.18 drift query validation", () => {
  it("R3.18 a missing or oversized spot_class_key is a 400 and a logged-out read is a 401", async () => {
    const { app, player } = await setUp();
    const missing = await app.inject({ method: "GET", url: DRIFT_PATH, headers: player.read });
    expect(missing.statusCode).toBe(400);
    const oversized = await getDrift(app, player, "k".repeat(129));
    expect(oversized.statusCode).toBe(400);
    const anonymous = await app.inject({ method: "GET", url: `${DRIFT_PATH}?spot_class_key=x` });
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });
});
