/**
 * Automated sessions over the test database and the fixture solver-query (R4.10, O-270, O-272,
 * O-274, O-215, ADR 0018): the first block is a worked example with every panel visible and its
 * decisions unrated; the block closes after its three hands, writing a new card due now and mastery
 * at the prior then and not before; consecutive blocks never share a family; a confident miss is
 * served at the first pick the interleave rule allows; a carded class the catalog no longer lists is
 * skipped and its pair requested, with no solution row written; no covered class is a 422 that
 * still records the gaps; an unknown configuration is a 400.
 */
import { BKT_PARAMETERS, MISTAKE_FROM_PCT_POT } from "@g-tee-oh/learning";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { invalidateClassCatalogs, loadClassCatalog } from "../src/automated/class-catalog.js";
import { REVIEW_BLOCK_INSTANCES } from "../src/automated/queue.js";
import type { Database } from "../src/db.js";
import { PANEL_KEYS } from "../src/schemas/drills.js";
import {
  createAutomated,
  decideOnce,
  derivedNow,
  learningOfSession,
  nextPrompt,
  ONLINE_100,
  requireAutomated,
  seedCards,
  worstAction,
} from "./R4.10-automated-kit.js";
import { newPlayer } from "./sessions-test-kit.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";

/** A live configuration the fixture library holds no solution for. */
const LIVE_150 = "cfg_9_live_13_150";
const NINE_MAX_PAIRS = 36;
const BLOCKS_PLAYED = 4;
const CLOSE_MS = 60_000;

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

async function cardCount(userId: string): Promise<number> {
  const result = await pool.query<{ n: number }>("select count(*)::int as n from schedule_card where user_id = $1", [userId]);
  return result.rows[0]?.n ?? 0;
}

describe("R4.10 automated session create and worked-example blocks (O-272)", () => {
  it("R4.10 the first block of a new player is a worked example: every panel visible and every decision unrated", async () => {
    const player = await newPlayer(database);
    const session = await requireAutomated(app, player);
    expect(session.rated_eligible).toBe(true);
    expect(session.automated).toMatchObject({ served: 0, size: REVIEW_BLOCK_INSTANCES, worked_example: true });
    const prompt = await nextPrompt(app, player, session.session_id);
    expect(prompt.worked_example).toBe(true);
    expect(prompt.visible_panels).toEqual([...PANEL_KEYS]);
    expect(prompt.spot_class_key).toBe(session.automated?.spot_class_key);
    expect(prompt.track_key).toBe(session.automated?.track_key);
    const { feedback } = await decideOnce(app, player, session.session_id);
    expect(feedback.rated).toBe(false);
    const row = await pool.query("select panels_revealed, rated from attempt where session_id = $1", [session.session_id]);
    expect(row.rows).toEqual([{ panels_revealed: true, rated: false }]);
  });

  it("R4.10 a block closes after its three hands: a new card due now and mastery at the prior, not before", async () => {
    const player = await newPlayer(database);
    const session = await requireAutomated(app, player);
    const first = session.automated!;
    for (let hand = 1; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
      const { feedback } = await decideOnce(app, player, session.session_id);
      expect(feedback.review_block).toBeNull();
      expect(await cardCount(player.userId)).toBe(0);
    }
    const started = Date.now();
    const { feedback } = await decideOnce(app, player, session.session_id);
    expect(feedback.review_block).toMatchObject({ spot_class_key: first.spot_class_key, closed: true, fsrs_grade: null, p_known: BKT_PARAMETERS.prior });
    const card = await pool.query<{ spot_class_key: string; due: Date }>("select spot_class_key, due from schedule_card where user_id = $1", [player.userId]);
    expect(card.rows.map((one) => one.spot_class_key)).toEqual([first.spot_class_key]);
    expect(Math.abs((card.rows[0]?.due ?? new Date(0)).getTime() - started)).toBeLessThan(CLOSE_MS);
    const mastery = await pool.query<{ p_known: number }>("select p_known from mastery where user_id = $1", [player.userId]);
    expect(mastery.rows[0]?.p_known).toBeCloseTo(BKT_PARAMETERS.prior, 6);
    const learning = await learningOfSession(database, player.userId, session.session_id);
    expect(learning.block.served).toBe(0);
    expect(learning.block.family).not.toBe(first.family);
    expect(learning.pick_no).toBe(2);
  });

  it("R4.10 consecutive blocks never share a family while two families are on offer", async () => {
    const player = await newPlayer(database);
    const session = await requireAutomated(app, player);
    const families = [session.automated!.family];
    for (let block = 1; block < BLOCKS_PLAYED; block += 1) {
      for (let hand = 0; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
        await decideOnce(app, player, session.session_id);
      }
      families.push((await learningOfSession(database, player.userId, session.session_id)).block.family);
    }
    families.slice(1).forEach((family, index) => expect(family).not.toBe(families[index]));
  });
});

describe("R4.10 confident misses (O-215)", () => {
  it("R4.10 a sure miss is served at the first pick the interleave rule allows", async () => {
    const player = await newPlayer(database);
    await seedCards(database, player.userId, classKeys);
    const session = await requireAutomated(app, player);
    const missed = session.automated!;
    expect(missed.worked_example).toBe(false);
    let sawMiss = false;
    for (let hand = 0; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
      const worst = worstAction(await derivedNow(database, player.userId, session.session_id));
      const { feedback } = await decideOnce(app, player, session.session_id, { actionIndex: worst.index, confidence: "sure" });
      sawMiss ||= worst.lossPctPot >= MISTAKE_FROM_PCT_POT && !["best", "correct"].includes(feedback.label);
    }
    expect(sawMiss).toBe(true);
    const afterMiss = await learningOfSession(database, player.userId, session.session_id);
    expect(afterMiss.queue.hypercorrection).toEqual([missed.spot_class_key]);
    expect(afterMiss.block.family).not.toBe(missed.family);
    for (let hand = 0; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
      await decideOnce(app, player, session.session_id);
    }
    const revisited = await learningOfSession(database, player.userId, session.session_id);
    expect(revisited.block.spot_class_key).toBe(missed.spot_class_key);
    expect(revisited.queue.hypercorrection).toEqual([]);
  });
});

describe("R4.10 coverage (O-270, O-240, ADR 0018)", () => {
  it("R4.10 a carded class the catalog no longer lists is skipped and its pair requested, with no solution row written", async () => {
    const player = await newPlayer(database);
    const goneKey = "preflop/online/100/rfi/retired-class";
    const solution = await pool.query<{ id: string }>(
      "select id from solution where game_config_id = $1 and position_pair = 'BB-BTN' and kind = 'preflop' limit 1",
      [ONLINE_100],
    );
    const solutionId = solution.rows[0]?.id ?? "";
    const session = await pool.query<{ id: string }>(
      `insert into practice_session (user_id, mode, settings, state) values ($1, 'drill', '{}', '{}') returning id`,
      [player.userId],
    );
    await pool.query(
      `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, action_index,
         action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight)
       values ($1, $2, $3, 'cfg_6_online_100/BB-BTN/', $4, '{}', 'AhKd', 0, 'f', 0, 0, 0, 0, 0, 1, 'best', false, 0)`,
      [player.userId, session.rows[0]?.id, solutionId, goneKey],
    );
    await seedCards(database, player.userId, [goneKey]);
    const created = await requireAutomated(app, player);
    expect(created.automated?.spot_class_key).not.toBe(goneKey);
    const requests = await pool.query<{ game_config_id: string; position_pair: string; line: string | null }>("select game_config_id, position_pair, line from coverage_request where user_id = $1", [player.userId]);
    expect(requests.rows).toEqual([{ game_config_id: ONLINE_100, position_pair: "BB-BTN", line: null }]);
    // No solution row can come from this request: the api connects as app, which holds no insert or update on
    // solution (ADR 0018). A global row count would race the other suites that insert fixture solutions.
    const privileges = await pool.query<{ can_insert: boolean; can_update: boolean }>(
      "select has_table_privilege('app', 'solution', 'INSERT') as can_insert, has_table_privilege('app', 'solution', 'UPDATE') as can_update",
    );
    expect(privileges.rows[0]).toEqual({ can_insert: false, can_update: false });
  });

  it("R4.10 a scope with no covered class is a 422 no-coverage that still records every gap once", async () => {
    const player = await newPlayer(database);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await createAutomated(app, player, { config_ids: [LIVE_150] });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ status: 422 });
      expect(String(response.json<{ type: string }>().type)).toContain("no-coverage");
    }
    const requests = await pool.query<{ n: number }>("select count(*)::int as n from coverage_request where user_id = $1 and game_config_id = $2", [
      player.userId,
      LIVE_150,
    ]);
    expect(requests.rows[0]?.n).toBe(NINE_MAX_PAIRS);
    const sessions = await pool.query<{ n: number }>("select count(*)::int as n from practice_session where user_id = $1", [player.userId]);
    expect(sessions.rows[0]?.n).toBe(0);
  });

  it("R4.10 a scope naming a configuration the catalog does not serve is a 400", async () => {
    const player = await newPlayer(database);
    const response = await createAutomated(app, player, { config_ids: ["cfg_2_online_norake_10"] });
    expect(response.statusCode).toBe(400);
  });
});
