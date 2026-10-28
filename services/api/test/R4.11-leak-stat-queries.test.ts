/**
 * The decision path's learning-state cost (R4.11, PR #27 review MEDIUM 12 and LOW 15): the shared
 * effects of one decision run two statements once the track map is cached (the grouped class and
 * track read, then the upsert), where they ran five before (a track read in beforeGrade, a track
 * read, the class rows, every attempt of the track and the upsert in afterInsert); the prior comes
 * from the catalog the prepare phase loaded, never from a catalog load in the transaction; and the
 * grouped read gives the same row as learning over the raw attempts.
 */
import { classStat, leakStat, trackAverage, type LeakDecision } from "@g-tee-oh/learning";
import type { KyselyPlugin } from "kysely";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { countRatedToday } from "../src/grading/attempts.js";
import type { AfterInsertContext } from "../src/learning/effects.js";
import { recomputeLeakStat } from "../src/learning-state/leak-stat.js";
import { resetTrackIdCache, trackIdsByKey } from "../src/learning-state/repository.js";
import { createSharedEffectsPart } from "../src/learning-state/shared-effects.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR } from "./sessions-fake-solver-query.js";
import { insertSolution } from "./sessions-test-kit.js";
import { automatedLearning, insertAttemptRow, insertSessionRow, trackIds } from "./R4.11-learning-state-kit.js";

const ROOT_CLASS = "preflop/online/100/rfi/BB-BTN";
const OTHER_CLASS = "preflop/online/100/rfi/BTN-CO";
const INJECTED_PRIOR = 25;
const CATALOG_PRIOR = 33;
const NOW = new Date("2026-10-27T12:00:00.000Z");
/** PR #27 review MEDIUM 12: statements per decision before (HEAD d0664ee) and after the fix. */
const STATEMENTS_BEFORE = 5;
const STATEMENTS_AFTER = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let tracks: Record<string, string>;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
  tracks = await trackIds(pool);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

/** A handle on the test database that counts the statements it runs. */
function countingDatabase(): { handle: Database; count: () => number } {
  let statements = 0;
  const plugin: KyselyPlugin = {
    // transformQuery also runs for every subquery builder; a result is one executed statement.
    transformQuery(args) {
      return args.node;
    },
    transformResult(args) {
      statements += 1;
      return Promise.resolve(args.result);
    },
  };
  return { handle: database.withPlugin(plugin), count: () => statements };
}

function hookContext(transaction: Database, userId: string, catalog?: ReadonlyMap<string, { frequencyPriorPer1k: number }>): AfterInsertContext {
  return {
    transaction,
    now: NOW,
    timeZone: TEST_CONFIG.timeZone,
    userId,
    session: { state: { learning: automatedLearning(ROOT_CLASS), seeded: false } },
    derived: { node: { spot_class_key: ROOT_CLASS, action_family: "rfi" }, hand: { hero_position: "BTN", config_id: FAKE_CONFIG } },
    grade: { difficulty_features: { ev_gap_pct_pot: 0, purity: 1, n_actions: 2, mixed: false, all_within_floor: false } },
    prepared: { catalog: catalog === undefined ? null : { byKey: catalog }, parts: {} },
  } as unknown as AfterInsertContext;
}

async function userWithTrackHistory(): Promise<string> {
  const user = await createTestUser(database);
  const opens = tracks.opens ?? "";
  const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(ROOT_CLASS) });
  const base = { userId: user.id, sessionId, solutionId, trackIds: [opens] };
  await insertAttemptRow(pool, { ...base, spotClassKey: ROOT_CLASS, label: "mistake", evLossBb: 2.5 });
  await insertAttemptRow(pool, { ...base, spotClassKey: ROOT_CLASS, label: "best", evLossBb: -0.001 });
  for (const label of ["blunder", "inaccuracy", "best", "best"]) {
    await insertAttemptRow(pool, { ...base, spotClassKey: OTHER_CLASS, label, evLossBb: label === "best" ? 0 : 1.75 });
  }
  return user.id;
}

async function leakRow(userId: string, key: string) {
  const result = await pool.query("select * from leak_stat where user_id = $1 and spot_class_key = $2", [userId, key]);
  return result.rows[0] as Record<string, number> | undefined;
}

describe("R4.11 the decision path's leak stat cost (PR #27 review MEDIUM 12)", () => {
  it(`R4.11 one decision's shared effects run ${STATEMENTS_AFTER} statements with a warm track map (${STATEMENTS_BEFORE} before)`, async () => {
    const userId = await userWithTrackHistory();
    await trackIdsByKey(database);
    const counting = countingDatabase();
    const part = createSharedEffectsPart({ frequencyPrior: () => Promise.resolve(INJECTED_PRIOR) });
    const context = hookContext(counting.handle, userId);
    await part.beforeGrade?.(context);
    await part.afterInsert?.(context);
    expect(counting.count()).toBe(STATEMENTS_AFTER);
    expect(await leakRow(userId, ROOT_CLASS)).toMatchObject({ n: 2, freq_prior_per_1k: INJECTED_PRIOR });
  });

  it("R4.11 the production part takes the prior from the prepared catalog and loads no catalog itself", async () => {
    const userId = await userWithTrackHistory();
    await trackIdsByKey(database);
    const counting = countingDatabase();
    const context = hookContext(counting.handle, userId, new Map([[ROOT_CLASS, { frequencyPriorPer1k: CATALOG_PRIOR }]]));
    await createSharedEffectsPart().afterInsert?.(context);
    expect(counting.count()).toBe(STATEMENTS_AFTER);
    expect(await leakRow(userId, ROOT_CLASS)).toMatchObject({ n: 2, freq_prior_per_1k: CATALOG_PRIOR });
  });

  it("R4.11 the grouped read writes the row learning makes over the raw attempts", async () => {
    const userId = await userWithTrackHistory();
    await recomputeLeakStat(database, { userId, spotClassKey: ROOT_CLASS, trackKey: "opens", frequencyPriorPer1k: INJECTED_PRIOR, now: NOW });
    const own: LeakDecision[] = [
      { label: "Mistake", evLossBb: 2.5 },
      { label: "Best", evLossBb: 0 },
    ];
    const other: LeakDecision[] = [
      { label: "Blunder", evLossBb: 1.75 },
      { label: "Inaccuracy", evLossBb: 1.75 },
      { label: "Best", evLossBb: 0 },
      { label: "Best", evLossBb: 0 },
    ];
    const track = trackAverage([classStat(own), classStat(other)]);
    if (track === null) {
      throw new Error("the track has decisions");
    }
    const expected = leakStat(ROOT_CLASS, INJECTED_PRIOR, own, track);
    const row = await leakRow(userId, ROOT_CLASS);
    expect(row?.n).toBe(expected.n);
    expect(row?.miss_rate).toBeCloseTo(expected.missRate, 5);
    expect(row?.ev_per_miss_bb).toBeCloseTo(expected.evPerMissBb, 4);
    expect(row?.leak_cost_bb_per_1k).toBeCloseTo(expected.leakCostBbPer1k, 3);
  });
});

describe("R4.11 the track map cache (PR #27 review LOW 15)", () => {
  it("R4.11 the track map is read once and then answered without a query", async () => {
    resetTrackIdCache();
    const counting = countingDatabase();
    const first = await trackIdsByKey(counting.handle);
    const second = await trackIdsByKey(counting.handle);
    expect(counting.count()).toBe(1);
    expect(second).toEqual(first);
    expect(first.get("opens")).toBe(tracks.opens);
  });
});

describe("R4.11 one countRatedToday with an optional track filter (PR #27 review LOW 15, O-214, O-247)", () => {
  it("R4.11 the track filter counts only today's rated attempts carrying the track", async () => {
    const user = await createTestUser(database);
    const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated", learning: automatedLearning(ROOT_CLASS) });
    const base = { userId: user.id, sessionId, solutionId, spotClassKey: ROOT_CLASS, rated: true, createdAt: NOW };
    await insertAttemptRow(pool, { ...base, trackIds: [tracks.opens ?? ""] });
    await insertAttemptRow(pool, { ...base, trackIds: [tracks.opens ?? ""] });
    await insertAttemptRow(pool, { ...base, trackIds: [tracks["facing-3bet"] ?? ""] });
    await insertAttemptRow(pool, { ...base, trackIds: [tracks.opens ?? ""], rated: false });
    await insertAttemptRow(pool, { ...base, trackIds: [tracks.opens ?? ""], createdAt: new Date(NOW.getTime() - DAY_MS) });
    expect(await countRatedToday(database, user.id, NOW, "UTC")).toBe(3);
    expect(await countRatedToday(database, user.id, NOW, "UTC", { trackId: tracks.opens ?? "" })).toBe(2);
  });
});
