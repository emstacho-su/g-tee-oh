/**
 * Streak and cosmetic writes over the test database (R4.14, O-278, O-279, O-252):
 * - recordRatedDecision counts rated decisions per local day, writes freeze_used and repaired as the
 *   pure rules give them, and unlocks streak cosmetics once; the stored flags and GET /progress/streak
 *   equal the rules recomputed on read (read equals write);
 * - the hook part counts only rated decisions of unseeded automated sessions;
 * - at session end the tier comes from the session's own ratings and the catalog's weights, tier
 *   cosmetics unlock once, a repeat end writes nothing and answers the same, and without solver-query
 *   the end is a 503.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { loadClassCatalog, type ClassCatalog, type CatalogClass } from "../src/automated/class-catalog.js";
import type { Database } from "../src/db.js";
import { HOLDOUT_HOOK_PART } from "../src/holdout/effects.js";
import { EMPTY_PREPARED_LEARNING, type AfterInsertContext, type SessionEndContext } from "../src/learning/effects.js";
import { insertSession, type SessionRow } from "../src/sessions/repository.js";
import { initialState, type LearningState } from "../src/sessions/state.js";
import { addDays, isoDateOf } from "../src/streaks/calendar.js";
import { computeStreak } from "../src/streaks/rules.js";
import { recordRatedDecision, sessionUnlocks, streakView, tierUnlocks } from "../src/streaks/repository.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";
import { newPlayer, TRAINER, type Player } from "./sessions-test-kit.js";

const TIME_ZONE = TEST_CONFIG.timeZone;
// 2026-10-05 is a Monday.
const MON = "2026-10-05";
const NOON_MS = 12 * 60 * 60 * 1000;
const at = (offset: number): Date => new Date(Date.parse(`${addDays(MON, offset)}T00:00:00Z`) + NOON_MS);
const VOLATILITY = 0.06;

let database: Database;
let pool: pg.Pool;
let app: ApiApp;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  app = buildTrainerApp(database);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

async function recordMany(userId: string, dayOffset: number, count: number): Promise<string[]> {
  const unlocked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    unlocked.push(...(await database.transaction().execute((transaction) => recordRatedDecision(transaction, { userId, now: at(dayOffset), timeZone: TIME_ZONE }))));
  }
  return unlocked;
}

async function storedDays(userId: string) {
  const rows = await database.selectFrom("streak_day").select(["day", "rated_decisions", "freeze_used", "repaired"]).where("user_id", "=", userId).execute();
  return rows.map((row) => ({ ...row, day: isoDateOf(row.day) })).sort((left, right) => left.day.localeCompare(right.day));
}

describe("R4.14 streak writes", () => {
  it("R4.14 freezes and a repair are written as the rules give them, the milestone unlocks once, and read equals write", async () => {
    const player = await newPlayer(database);
    expect(await recordMany(player.userId, 0, 5)).toEqual([]);
    // Tue and Wed missed (frozen), Thu missed with no freeze left, Fri 6 and Sat 4 repair Thu.
    expect(await recordMany(player.userId, 4, 6)).toEqual([]);
    const unlocked = await recordMany(player.userId, 5, 4);
    expect(unlocked).toEqual(["badge-streak-3"]);
    const days = await storedDays(player.userId);
    const counts = new Map(days.map((row) => [row.day, row.rated_decisions]));
    const rules = computeStreak(counts, addDays(MON, 5));
    expect(rules).toMatchObject({ currentDays: 3, frozenDays: [addDays(MON, 1), addDays(MON, 2)], repairedDays: [addDays(MON, 3)] });
    expect(days.filter((row) => row.freeze_used).map((row) => row.day)).toEqual(rules.frozenDays);
    expect(days.filter((row) => row.repaired).map((row) => row.day)).toEqual(rules.repairedDays);
    const view = await streakView(database, player.userId, at(5), TIME_ZONE);
    expect(view).toMatchObject({ current_days: 3, longest_days: 3, today_rated: 4, day_minimum: 5, freezes_left_this_week: 0, repairable: null });
    expect(view.unlocks.map((unlock) => unlock.cosmetic_key)).toEqual(["badge-streak-3"]);
    expect(view.next_milestone).toEqual({ days: 7, cosmetic_key: "badge-streak-7" });
  });

  it("R4.14 a pending repair shows its deadline, progress and need", async () => {
    const player = await newPlayer(database);
    await recordMany(player.userId, 0, 5);
    await recordMany(player.userId, 4, 3);
    const view = await streakView(database, player.userId, at(4), TIME_ZONE);
    expect(view.repairable).toEqual({ day: addDays(MON, 3), deadline: `${addDays(MON, 6)}T00:00:00.000Z`, last_day: addDays(MON, 5), progress: 3, needed: 10 });
    expect(view.current_days).toBe(1);
  });

  it.each([
    ["Europe/Berlin", "2026-10-10T22:00:00.000Z"],
    ["America/Los_Angeles", "2026-10-11T07:00:00.000Z"],
  ])("R4.14 in %s the deadline is local midnight and last_day the local day before it", async (timeZone, deadline) => {
    const player = await newPlayer(database);
    await recordMany(player.userId, 0, 5);
    await recordMany(player.userId, 4, 3);
    const view = await streakView(database, player.userId, at(4), timeZone);
    expect(view.repairable).toMatchObject({ day: addDays(MON, 3), deadline, last_day: addDays(MON, 5) });
  });
});

function automated(seeded: boolean): LearningState {
  return {
    kind: "automated",
    seeded,
    config_ids: [],
    pick_no: 1,
    queue: { last_family: null },
    block: { spot_class_key: "k", family: "rfi", track_key: "opens", worked_example: false, served: 0, size: 3 },
  };
}

const SPOT = { preflop_action: ["rfi" as const], hands: { mode: "all" as const }, alternate_seats: false };
const HERO_SPOT = { config_id: "cfg_6_online_100", pair: "BB-BTN", line: null, hero_seat: "BTN" as const, history: [] };

async function automatedSession(player: Player, seeded: boolean): Promise<SessionRow> {
  const state = initialState("00000000000000aa", [HERO_SPOT], SPOT, { learning: automated(seeded) });
  return insertSession(database, { userId: player.userId, mode: "automated", drillId: null, settings: { ...TRAINER, stop_rule: "after_action" }, state });
}

describe("R4.14 the hook part counts rated decisions of unseeded automated sessions only", () => {
  it("R4.14 rated counts; unrated and seeded do not", async () => {
    const player = await newPlayer(database);
    const cases = [
      { seeded: false, rated: true },
      { seeded: false, rated: false },
      { seeded: true, rated: false },
    ];
    for (const { seeded, rated } of cases) {
      const session = await automatedSession(player, seeded);
      const context = {
        transaction: database,
        now: at(0),
        timeZone: TIME_ZONE,
        userId: player.userId,
        session,
        next: session.state,
        attempt: { id: randomUUID(), rated },
      } as unknown as AfterInsertContext;
      expect(await HOLDOUT_HOOK_PART.afterInsert?.(context)).toEqual({});
    }
    expect((await storedDays(player.userId)).map((row) => row.rated_decisions)).toEqual([1]);
  });
});

function catalogClass(trackKey: "opens" | "blind-defense", prior: number, pot: number): CatalogClass {
  return {
    spotClassKey: `test/${trackKey}`,
    family: trackKey === "opens" ? "rfi" : "facing-open",
    format: "online",
    depthBand: "100",
    trackKey,
    heroPosition: trackKey === "opens" ? "BTN" : "BB",
    frequencyPriorPer1k: prior,
    meanPotBb: pot,
    options: [],
  };
}

const TWO_TRACKS: ClassCatalog = (() => {
  const classes = [catalogClass("opens", 40, 2.5), catalogClass("blind-defense", 20, 5)];
  return { classes, byKey: new Map(classes.map((cls) => [cls.spotClassKey, cls])), coveredPairs: [], uncoveredPairs: [], unavailablePairs: [] };
})();

async function rateTrack(userId: string, sessionId: string, key: string, mu: number, rd: number, recordedAt: Date): Promise<void> {
  await pool.query(
    "insert into rating_history (user_id, track_id, session_id, mu, rd, volatility, recorded_at) select $1, id, $2, $3, $4, $5, $6 from track where key = $7",
    [userId, sessionId, mu, rd, VOLATILITY, recordedAt, key],
  );
}

describe("R4.14 tier unlocks at session end", () => {
  it("R4.14 the session's ratings give the tier, its cosmetics unlock once, and a repeat writes nothing and answers the same", async () => {
    const player = await newPlayer(database);
    const session = await automatedSession(player, false);
    const ratedAt = new Date();
    await rateTrack(player.userId, session.id, "opens", 1700, 50, ratedAt);
    await rateTrack(player.userId, session.id, "blind-defense", 1600, 60, ratedAt);
    const first = await tierUnlocks(database, { userId: player.userId, sessionId: session.id, catalog: TWO_TRACKS, write: true });
    expect(first).toEqual({
      tier: { overall: 1540, tier: "III", band_tier: "III", blocked_by: [] },
      unlocks: ["badge-tier-II", "badge-tier-III", "felt-tier-III"],
    });
    const repeat = await tierUnlocks(database, { userId: player.userId, sessionId: session.id, catalog: TWO_TRACKS, write: false });
    expect(repeat).toEqual({ tier: first.tier, unlocks: [] });
    const again = await tierUnlocks(database, { userId: player.userId, sessionId: session.id, catalog: TWO_TRACKS, write: true });
    expect(again.unlocks).toEqual([]);
    const unlocks = await sessionUnlocks(database, player.userId, new Date(0), new Date(Date.now() + NOON_MS));
    expect(unlocks.sort()).toEqual(["badge-tier-II", "badge-tier-III", "felt-tier-III"]);
  });

  it("R4.14 a session that rated nothing has no tier and unlocks nothing", async () => {
    const player = await newPlayer(database);
    const session = await automatedSession(player, false);
    expect(await tierUnlocks(database, { userId: player.userId, sessionId: session.id, catalog: TWO_TRACKS, write: true })).toEqual({ tier: null, unlocks: [] });
  });

  it("R4.14 the end hook computes the tier over the prepared fixture catalog, repeats it, and is a 503 with none prepared", async () => {
    const player = await newPlayer(database);
    const session = await automatedSession(player, false);
    await rateTrack(player.userId, session.id, "opens", 1800, 60, new Date());
    const ended = { ...session, endedAt: new Date(Date.now() + NOON_MS) };
    // PR #27 review HIGH 3: the tier reads the catalog the end's prepare phase loaded (learning/prepare.ts).
    const prepared = { catalog: await loadClassCatalog(fixtureSolverQuery(), database), parts: {} };
    const context = (firstEnd: boolean, withSolver: boolean) =>
      ({
        transaction: database,
        now: new Date(),
        timeZone: TIME_ZONE,
        userId: player.userId,
        session,
        ended,
        firstEnd,
        solverQuery: withSolver ? fixtureSolverQuery() : null,
        prepared: withSolver ? prepared : EMPTY_PREPARED_LEARNING,
      }) as SessionEndContext;
    const first = await HOLDOUT_HOOK_PART.onSessionEnd?.(context(true, true));
    expect(first?.tier).not.toBeNull();
    expect(first?.tier?.tier).toBeDefined();
    expect(first?.unlocks).toEqual(await sessionUnlocks(database, player.userId, session.startedAt, ended.endedAt));
    expect(await HOLDOUT_HOOK_PART.onSessionEnd?.(context(false, true))).toEqual(first);
    await expect(HOLDOUT_HOOK_PART.onSessionEnd?.(context(true, false))).rejects.toMatchObject({ status: 503 });
  });
});
