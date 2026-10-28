/**
 * The review block close (R4.11, O-272, O-273, O-253) against the test database: a worked example
 * writes a new card due now and mastery at the prior (keeping any existing row), a reviewed block
 * writes learning's FSRS review graded against the typical time of the earlier attempts (the block's
 * own skipped) at the retention its mastery sets, and BKT over the instances in order; an empty
 * block writes nothing; nothing is written before the close.
 */
import {
  BKT_PARAMETERS,
  MASTERED_RETENTION,
  newSpotClassCard,
  observationFromLabel,
  retentionFor,
  reviewGrade,
  reviewSpotClass,
  updateMastery,
  type Mastery,
} from "@g-tee-oh/learning";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { spotClassCardOf, storedCardOf } from "../src/learning-state/fsrs-card.js";
import { closeReviewBlock, type BlockAttempt } from "../src/learning-state/review-block.js";
import { TYPICAL_RESPONSE_MS_DEFAULT } from "../src/learning-state/typical-time.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { insertSolution } from "./sessions-test-kit.js";
import { insertAttemptRow, insertSessionRow, learningRows, KIT_CONFIG, KIT_PAIR } from "./R4.11-learning-state-kit.js";

const CLASS = "preflop/online/100/facing-open/BB-BTN";
const NOW = new Date("2026-10-27T12:00:00.000Z");
const EARLIER = new Date("2026-10-20T12:00:00.000Z");
const MINUTE_MS = 60_000;
const BLOCK_MS = 500;
const MASTERED_P = 0.96;

let database: Database;
let pool: pg.Pool;
let solutionId: string;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, KIT_CONFIG, KIT_PAIR);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

const BLOCK: readonly BlockAttempt[] = [
  { score: 1, responseMs: BLOCK_MS, label: "best" },
  { score: 1, responseMs: BLOCK_MS, label: "correct" },
  { score: 1, responseMs: BLOCK_MS, label: "best" },
];

/** A user with `earlier` panels-hidden attempts at `earlierMs`, then the block's own attempts, newest last. */
async function userWithHistory(earlier: number, earlierMs: number) {
  const user = await createTestUser(database);
  const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated" });
  const base = { userId: user.id, sessionId, solutionId, spotClassKey: CLASS };
  for (let index = 0; index < earlier; index += 1) {
    await insertAttemptRow(pool, { ...base, responseMs: earlierMs, createdAt: new Date(EARLIER.getTime() + index * MINUTE_MS) });
  }
  for (const [index, attempt] of BLOCK.entries()) {
    await insertAttemptRow(pool, { ...base, label: attempt.label, responseMs: attempt.responseMs, createdAt: new Date(NOW.getTime() - (BLOCK.length - index) * MINUTE_MS) });
  }
  return user.id;
}

async function stored(userId: string) {
  const card = await pool.query<{ fsrs_state: unknown; due: Date }>(
    "select fsrs_state, due from schedule_card where user_id = $1 and spot_class_key = $2",
    [userId, CLASS],
  );
  const mastery = await pool.query<{ p_known: number }>("select p_known from mastery where user_id = $1 and spot_class_key = $2", [userId, CLASS]);
  const cardRow = card.rows[0];
  return {
    card: cardRow === undefined ? undefined : spotClassCardOf(CLASS, cardRow.fsrs_state),
    due: cardRow?.due,
    pKnown: mastery.rows[0]?.p_known,
  };
}

function masteryOver(before: Mastery): Mastery {
  return BLOCK.reduce<Mastery>(
    (mastery, attempt) => updateMastery(mastery, observationFromLabel(attempt.label === "best" ? "Best" : "Correct")).mastery,
    before,
  );
}

describe("R4.11 worked-example block close (O-272)", () => {
  it("R4.11 a worked example writes a new card due now and mastery at the prior, and reviews nothing", async () => {
    const userId = await userWithHistory(0, BLOCK_MS);
    expect(await stored(userId)).toEqual({ card: undefined, due: undefined, pKnown: undefined });
    const extras = await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: true, attempts: BLOCK, now: NOW });
    const row = await stored(userId);
    expect(row.card?.card).toEqual(newSpotClassCard(CLASS, NOW).card);
    expect(row.due).toEqual(NOW);
    expect(row.pKnown).toBeCloseTo(BKT_PARAMETERS.prior);
    expect(extras).toMatchObject({ spot_class_key: CLASS, closed: true, fsrs_grade: null, next_due: NOW.toISOString() });
    expect(extras.p_known).toBeCloseTo(BKT_PARAMETERS.prior);
  });

  it("R4.11 a worked example never resets an existing card or mastery", async () => {
    const userId = await userWithHistory(0, BLOCK_MS);
    await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: false, attempts: BLOCK, now: NOW });
    const before = await learningRows(pool, userId);
    await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: true, attempts: [], now: new Date(NOW.getTime() + MINUTE_MS) });
    expect(await learningRows(pool, userId)).toEqual(before);
  });
});

describe("R4.11 reviewed block close (O-272, O-273, O-253)", () => {
  it("R4.11 fewer than five earlier attempts grade against 8000 ms, and the block's own attempts are not earlier", async () => {
    // Four earlier attempts at 400 ms: under five, so typical is 8000 ms and a 500 ms block is Easy.
    // Counting the block's own three would make seven samples with a median of 500 ms, and Good.
    const userId = await userWithHistory(4, 400);
    const extras = await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: false, attempts: BLOCK, now: NOW });
    const grade = reviewGrade({ scores: [1, 1, 1], responseMs: [BLOCK_MS, BLOCK_MS, BLOCK_MS], typicalResponseMs: TYPICAL_RESPONSE_MS_DEFAULT });
    expect(grade).toBe("Easy");
    expect(extras.fsrs_grade).toBe("Easy");
    const card = reviewSpotClass(newSpotClassCard(CLASS, NOW), grade, NOW, { requestRetention: retentionFor(false) });
    const row = await stored(userId);
    expect(row.card?.card).toEqual(card.card);
    expect(row.due).toEqual(card.card.due);
    expect(extras.next_due).toBe(card.card.due.toISOString());
    const mastery = masteryOver({ pKnown: BKT_PARAMETERS.prior });
    expect(row.pKnown).toBeCloseTo(mastery.pKnown, 5);
    expect(extras.p_known).toBeCloseTo(mastery.pKnown, 10);
  });

  it("R4.11 five earlier attempts set the typical time: slower than their median is Good, not Easy", async () => {
    const userId = await userWithHistory(5, 400);
    const extras = await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: false, attempts: BLOCK, now: NOW });
    expect(extras.fsrs_grade).toBe("Good");
  });

  it("R4.11 a stored card is reviewed at the mastered retention when mastery is at the threshold", async () => {
    const userId = await userWithHistory(0, BLOCK_MS);
    const earlierCard = reviewSpotClass(newSpotClassCard(CLASS, EARLIER), "Good", EARLIER);
    await pool.query("insert into schedule_card (user_id, spot_class_key, fsrs_state, due) values ($1, $2, $3::jsonb, $4)", [
      userId,
      CLASS,
      JSON.stringify(storedCardOf(earlierCard)),
      earlierCard.card.due,
    ]);
    await pool.query("insert into mastery (user_id, spot_class_key, p_known, updated_at) values ($1, $2, $3, $4)", [userId, CLASS, MASTERED_P, EARLIER]);
    await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: false, attempts: BLOCK, now: NOW });
    const storedBefore = await pool.query<{ p: number }>("select 0.96::real::float8 as p");
    const pBefore = Number(storedBefore.rows[0]?.p);
    const expected = reviewSpotClass(earlierCard, "Easy", NOW, { requestRetention: MASTERED_RETENTION });
    const row = await stored(userId);
    expect(row.card?.card).toEqual(expected.card);
    expect(row.pKnown).toBeCloseTo(masteryOver({ pKnown: pBefore }).pKnown, 5);
  });

  it("R4.11 a block with no attempts writes nothing", async () => {
    const userId = await userWithHistory(0, BLOCK_MS);
    const before = await learningRows(pool, userId);
    const extras = await closeReviewBlock(database, { userId, spotClassKey: CLASS, workedExample: false, attempts: [], now: NOW });
    expect(await learningRows(pool, userId)).toEqual(before);
    expect(extras).toEqual({ spot_class_key: CLASS, closed: true, fsrs_grade: null, next_due: null, p_known: null });
  });
});
