/**
 * The automated rated rules in the decision transaction (R4.10, O-274, O-214, O-247, the PM seed
 * condition), over the test database and the fixture solver-query:
 * - first attempt: an earlier attempt at the same (solution, node, hand class), in any mode, makes
 *   the decision a non-first attempt;
 * - per-track cap: ratedTodayInTrack counts only today's rated attempts in the block's track, and at
 *   learning's DAILY_RATED_CAP the decision is unrated;
 * - a client-seeded session's decisions are all unrated and leave every learning table unchanged,
 *   while an unseeded twin over the same cards writes them;
 * - replay: the same seed gives the same blocks and the same prompts.
 */
import { DAILY_RATED_CAP } from "@g-tee-oh/learning";
import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { AUTOMATED_HOOK_PART } from "../src/automated/effects.js";
import { invalidateClassCatalogs, loadClassCatalog } from "../src/automated/class-catalog.js";
import { REVIEW_BLOCK_INSTANCES } from "../src/automated/queue.js";
import type { Database } from "../src/db.js";
import { EMPTY_PREPARED_LEARNING, type DecisionContext } from "../src/learning/effects.js";
import { findSession } from "../src/sessions/repository.js";
import {
  decideOnce,
  derivedNow,
  endSession,
  learningSnapshot,
  ONLINE_100,
  requireAutomated,
  seedCards,
} from "./R4.10-automated-kit.js";
import { newPlayer, type Player } from "./sessions-test-kit.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";

const SEED = "00000000c0ffee00";
const DAY_MS = 24 * 60 * 60 * 1000;
const REPLAY_DECISIONS = 2 * REVIEW_BLOCK_INSTANCES + 1;
const TWIN_DECISIONS = REVIEW_BLOCK_INSTANCES + 1;

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
let classKeys: string[];

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  app = buildTrainerApp(database);
  await app.ready();
  invalidateClassCatalogs();
  classKeys = (await loadClassCatalog(fixtureSolverQuery(), database, [ONLINE_100])).classes.map((cls) => cls.spotClassKey);
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

async function contextFor(player: Player, sessionId: string, now = new Date()): Promise<DecisionContext> {
  const session = await findSession(database, player.userId, sessionId);
  if (session === undefined) {
    throw new Error("no session");
  }
  const derived = await derivedNow(database, player.userId, sessionId);
  return {
    transaction: database,
    now,
    timeZone: TEST_CONFIG.timeZone,
    userId: player.userId,
    session,
    derived,
    grade: undefined as never,
    solverQuery: fixtureSolverQuery(),
    request: { id: "r4.10-test" } as FastifyRequest,
    prepared: EMPTY_PREPARED_LEARNING,
  };
}

async function trackId(key: string): Promise<string> {
  const result = await pool.query<{ id: string }>("select id from track where key = $1", [key]);
  return result.rows[0]?.id ?? "";
}

/** `count` rated attempts of the user, carrying `track`, created at `at`, in a throwaway drill session. */
async function insertRatedAttempts(userId: string, track: string, count: number, at: Date): Promise<void> {
  const solution = await pool.query<{ id: string }>("select id from solution where game_config_id = $1 limit 1", [ONLINE_100]);
  const session = await pool.query<{ id: string }>(`insert into practice_session (user_id, mode, settings, state) values ($1, 'drill', '{}', '{}') returning id`, [userId]);
  await pool.query(
    `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, action_index,
       action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight, created_at)
     select $1, $2, $3, 'cfg_6_online_100/BB-BTN/', 'filler', array[$4::uuid], 'AhKd', 0, 'f', 0, 0, 0, 0, 0, 1, 'best', true, 1, $6
     from generate_series(1, $5)`,
    [userId, session.rows[0]?.id, solution.rows[0]?.id, track, count, at],
  );
}

async function reviewSession(seed?: string): Promise<{ player: Player; sessionId: string; trackKey: string }> {
  const player = await newPlayer(database);
  await seedCards(database, player.userId, classKeys);
  const session = await requireAutomated(app, player, seed === undefined ? {} : { seed });
  return { player, sessionId: session.session_id, trackKey: session.automated?.track_key ?? "" };
}

describe("R4.10 first attempt by item (O-274)", () => {
  it("R4.10 an earlier attempt at the same solution, node and hand class makes the decision a non-first attempt", async () => {
    const { player, sessionId } = await reviewSession();
    const context = await contextFor(player, sessionId);
    expect(await AUTOMATED_HOOK_PART.beforeGrade?.(context)).toMatchObject({ mode: "automated", firstAttempt: true, panelsRevealed: false });
    const handClass = context.derived.node.hands[0]?.hand;
    const drill = await pool.query<{ id: string }>(`insert into practice_session (user_id, mode, settings, state) values ($1, 'drill', '{}', '{}') returning id`, [player.userId]);
    await pool.query(
      `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, hand_class, action_index,
         action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight)
       values ($1, $2, $3, $4, 'any', '{}', 'AhKd', $5, 0, 'f', 0, 0, 0, 0, 0, 1, 'best', false, 0)`,
      [player.userId, drill.rows[0]?.id, context.derived.hand.solution_id, context.derived.node.node_key, handClass],
    );
    expect((await AUTOMATED_HOOK_PART.beforeGrade?.(context))?.firstAttempt).toBe(false);
  });
});

describe("R4.10 per-track daily cap (O-274, O-214, O-247)", () => {
  it("R4.10 counts only today's rated attempts in the block's track", async () => {
    const { player, sessionId, trackKey } = await reviewSession();
    const context = await contextFor(player, sessionId);
    const other = trackKey === "opens" ? "facing-3bet" : "opens";
    await insertRatedAttempts(player.userId, await trackId(trackKey), 3, new Date(context.now.getTime() - 60_000));
    await insertRatedAttempts(player.userId, await trackId(other), 5, new Date(context.now.getTime() - 60_000));
    await insertRatedAttempts(player.userId, await trackId(trackKey), 7, new Date(context.now.getTime() - 2 * DAY_MS));
    expect((await AUTOMATED_HOOK_PART.beforeGrade?.(context))?.ratedTodayInTrack).toBe(3);
  });

  it("R4.10 at the cap the decision is unrated, while a twin under it is rated", async () => {
    const capped = await reviewSession();
    await insertRatedAttempts(capped.player.userId, await trackId(capped.trackKey), DAILY_RATED_CAP, new Date(Date.now() - 60_000));
    expect((await decideOnce(app, capped.player, capped.sessionId)).feedback.rated).toBe(false);
    const twin = await reviewSession();
    expect((await decideOnce(app, twin.player, twin.sessionId)).feedback.rated).toBe(true);
  });
});

describe("R4.10 seeded sessions (PM seed condition)", () => {
  it("R4.10 a seeded session is unrated end to end and leaves every learning table unchanged; its unseeded twin writes them", async () => {
    const seeded = await reviewSession(SEED);
    const twin = await reviewSession();
    const seededBefore = await learningSnapshot(pool, seeded.player.userId);
    const twinBefore = await learningSnapshot(pool, twin.player.userId);
    const seededRated: boolean[] = [];
    const twinRated: boolean[] = [];
    for (let decision = 0; decision < TWIN_DECISIONS; decision += 1) {
      seededRated.push((await decideOnce(app, seeded.player, seeded.sessionId)).feedback.rated);
      twinRated.push((await decideOnce(app, twin.player, twin.sessionId)).feedback.rated);
    }
    expect((await endSession(app, seeded.player, seeded.sessionId)).statusCode).toBe(200);
    expect((await endSession(app, twin.player, twin.sessionId)).statusCode).toBe(200);
    expect(seededRated.every((rated) => !rated)).toBe(true);
    expect(twinRated.some((rated) => rated)).toBe(true);
    const ratedRows = await pool.query<{ n: number }>("select count(*)::int as n from attempt where session_id = $1 and rated", [seeded.sessionId]);
    expect(ratedRows.rows[0]?.n).toBe(0);
    expect(await learningSnapshot(pool, seeded.player.userId)).toEqual(seededBefore);
    const twinAfter = await learningSnapshot(pool, twin.player.userId);
    expect(twinAfter.schedule_card).not.toEqual(twinBefore.schedule_card);
    expect(twinAfter.mastery.length).toBeGreaterThan(0);
    expect(twinAfter.leak_stat.length).toBeGreaterThan(0);
    expect(twinAfter.rating_history.length).toBeGreaterThan(0);
    const seededSession = await findSession(database, seeded.player.userId, seeded.sessionId);
    expect(seededSession?.state.learning).toMatchObject({ seeded: true, queue: { hypercorrection: [] } });
  });

  it("R4.10 the same seed replays the same blocks and prompts", async () => {
    const runs = await Promise.all(
      [0, 1].map(async () => {
        const player = await newPlayer(database);
        const session = await requireAutomated(app, player, { seed: SEED });
        expect(session.rated_eligible).toBe(false);
        const seen: unknown[] = [session.automated];
        for (let decision = 0; decision < REPLAY_DECISIONS; decision += 1) {
          const { prompt, feedback } = await decideOnce(app, player, session.session_id);
          seen.push({ hand: prompt.hero_hand, history: prompt.history, key: prompt.spot_class_key, block: feedback.review_block?.spot_class_key });
        }
        return seen;
      }),
    );
    expect(runs[1]).toEqual(runs[0]);
  });
});
