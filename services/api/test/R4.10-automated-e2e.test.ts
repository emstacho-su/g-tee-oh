/**
 * The automated loop end to end with the production learning hooks (R4.10, R4.11, O-27, O-240,
 * O-270, O-272, O-275), over the test database and the fixture solver-query: create an automated
 * session over a covered and an uncovered configuration, play two full review blocks and one hand of
 * a third, end it, and check every write the loop owes: a coverage request per uncovered pair, one
 * leak_stat per decided class, the three classes' cards reviewed and their mastery written (the
 * third at the end, as a partial block), a rating and one rating_history row per rated track tagged
 * with the session, a recap whose rating changes match those rows, and a repeat end that answers
 * the same recap and writes nothing. The prompts also carry S26's hand fields (R3.13, O-313, O-335):
 * automated sessions share the session machine, so each spot-mode hand is decision 1 of its hand and
 * names the hand before it in previous_hand.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { invalidateClassCatalogs, loadClassCatalog } from "../src/automated/class-catalog.js";
import { REVIEW_BLOCK_INSTANCES } from "../src/automated/queue.js";
import type { Database } from "../src/db.js";
import {
  decideOnce,
  endSession,
  learningOfSession,
  learningSnapshot,
  ONLINE_100,
  type PromptBody,
  requireAutomated,
  seedCards,
} from "./R4.10-automated-kit.js";
import { newPlayer } from "./sessions-test-kit.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";

const LIVE_150 = "cfg_9_live_13_150";
const NINE_MAX_PAIRS = 36;
const FULL_BLOCKS = 2;

interface Recap {
  decisions: number;
  rated_decisions: number;
  rating_changes: { track_key: string; before: { mu: number; rd: number } | null; after: { mu: number; rd: number } }[];
}

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
let classKeys: string[];

/** S26 (R3.13): one decision per hand under the stop rule; previous_hand names the hand served before. */
function expectHandFields(prompt: PromptBody, before: PromptBody | undefined): void {
  expect(prompt.hand_decision_no).toBe(1);
  if (before === undefined) {
    expect(prompt.previous_hand).toBeNull();
    return;
  }
  expect(prompt.hand_no).toBeGreaterThan(before.hand_no);
  expect(prompt.previous_hand?.hand_no).toBe(before.hand_no);
  // The hero takes action 0, often a fold; any other action ends the hand by the stop rule.
  expect(["fold", "stop_rule"]).toContain(prompt.previous_hand?.end);
}

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

async function cardDue(userId: string): Promise<Map<string, number>> {
  const rows = await pool.query<{ spot_class_key: string; due: Date }>("select spot_class_key, due from schedule_card where user_id = $1", [userId]);
  return new Map(rows.rows.map((row) => [row.spot_class_key, row.due.getTime()]));
}

describe("R4.10 automated loop end to end", () => {
  it("R4.10 R3.13 create, two blocks and a partial one, end: requests, leak stats, cards, mastery, rating, recap and hand fields", async () => {
    const player = await newPlayer(database);
    await seedCards(database, player.userId, classKeys);
    const dueBefore = await cardDue(player.userId);
    const session = await requireAutomated(app, player, { config_ids: [ONLINE_100, LIVE_150] });
    expect(session.rated_eligible).toBe(true);
    const requests = await pool.query<{ n: number }>(
      "select count(*)::int as n from coverage_request where user_id = $1 and game_config_id = $2 and line is null",
      [player.userId, LIVE_150],
    );
    expect(requests.rows[0]?.n).toBe(NINE_MAX_PAIRS);

    const blocks: string[] = [session.automated!.spot_class_key];
    const decidedClasses = new Set<string>();
    let lastPrompt: PromptBody | undefined;
    for (let block = 0; block < FULL_BLOCKS; block += 1) {
      for (let hand = 0; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
        const { prompt, feedback } = await decideOnce(app, player, session.session_id);
        expectHandFields(prompt, lastPrompt);
        lastPrompt = prompt;
        decidedClasses.add(prompt.spot_class_key ?? "");
        const closes = hand === REVIEW_BLOCK_INSTANCES - 1;
        expect(feedback.review_block === null).toBe(!closes);
        if (closes) {
          expect(feedback.review_block).toMatchObject({ spot_class_key: blocks[block], closed: true });
          expect(feedback.review_block?.fsrs_grade).not.toBeNull();
        }
      }
      blocks.push((await learningOfSession(database, player.userId, session.session_id)).block.spot_class_key);
    }
    const partial = await decideOnce(app, player, session.session_id);
    expectHandFields(partial.prompt, lastPrompt);
    decidedClasses.add(partial.prompt.spot_class_key ?? "");
    expect([...decidedClasses].sort()).toEqual([...new Set(blocks)].sort());

    const masteryBeforeEnd = await pool.query<{ spot_class_key: string }>("select spot_class_key from mastery where user_id = $1", [player.userId]);
    expect(masteryBeforeEnd.rows.map((row) => row.spot_class_key).sort()).toEqual([...new Set(blocks.slice(0, FULL_BLOCKS))].sort());

    const ended = await endSession(app, player, session.session_id);
    expect(ended.statusCode).toBe(200);
    const recap = ended.json<Recap>();
    expect(recap.decisions).toBe(FULL_BLOCKS * REVIEW_BLOCK_INSTANCES + 1);

    const dueAfter = await cardDue(player.userId);
    for (const key of new Set(blocks)) {
      expect(dueAfter.get(key)).not.toBe(dueBefore.get(key));
    }
    const mastery = await pool.query<{ spot_class_key: string }>("select spot_class_key from mastery where user_id = $1", [player.userId]);
    expect(mastery.rows.map((row) => row.spot_class_key).sort()).toEqual([...new Set(blocks)].sort());
    const leaks = await pool.query<{ spot_class_key: string }>("select spot_class_key from leak_stat where user_id = $1", [player.userId]);
    expect(leaks.rows.map((row) => row.spot_class_key).sort()).toEqual([...decidedClasses].sort());

    const history = await pool.query<{ key: string; mu: number; rd: number }>(
      `select t.key, h.mu, h.rd from rating_history h join track t on t.id = h.track_id where h.user_id = $1 and h.session_id = $2 order by t.key`,
      [player.userId, session.session_id],
    );
    expect(recap.rated_decisions).toBeGreaterThan(0);
    expect(history.rows.length).toBeGreaterThan(0);
    const ratings = await pool.query<{ n: number }>("select count(*)::int as n from rating where user_id = $1", [player.userId]);
    expect(ratings.rows[0]?.n).toBe(history.rows.length);
    expect(recap.rating_changes.map((change) => change.track_key).sort()).toEqual(history.rows.map((row) => row.key).sort());
    for (const change of recap.rating_changes) {
      const row = history.rows.find((one) => one.key === change.track_key);
      expect(change.after.mu).toBeCloseTo(row?.mu ?? Number.NaN, 3);
      expect(change.after.rd).toBeCloseTo(row?.rd ?? Number.NaN, 3);
      expect(change.before).toBeNull();
    }

    const snapshot = await learningSnapshot(pool, player.userId);
    const again = await endSession(app, player, session.session_id);
    expect(again.statusCode).toBe(200);
    expect(again.json<Recap>().rating_changes).toEqual(recap.rating_changes);
    expect(await learningSnapshot(pool, player.userId)).toEqual(snapshot);
  });
});
