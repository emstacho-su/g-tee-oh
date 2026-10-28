/**
 * The session-end rating period (R4.11, O-27, O-251, O-259) against the test database: one period per
 * track the session rated, after the inactivity of the stored rating's idle weeks; one
 * rating_history row per rated track tagged with the session; tracks without rated decisions
 * untouched; a repeat call writes nothing and answers the same changes.
 */
import {
  applyInactivity,
  newTrackRating,
  rateSession,
  type SessionDecision,
  type TrackRating,
} from "@g-tee-oh/learning";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db.js";
import { rateSessionTracks } from "../src/learning-state/rating-period.js";
import { adminPool, appDatabase, createTestUser } from "./support/database.js";
import { insertSolution } from "./sessions-test-kit.js";
import { insertAttemptRow, insertSessionRow, learningRows, trackIds, KIT_CONFIG, KIT_PAIR } from "./R4.11-learning-state-kit.js";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_DAYS = 21;
const IDLE_PERIODS = 3;
const CLASS = "preflop/online/100/rfi/BB-BTN";

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let tracks: Record<string, string>;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, KIT_CONFIG, KIT_PAIR);
  tracks = await trackIds(pool);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

const OPENS_DECISIONS: readonly SessionDecision[] = [
  { difficulty: 1500, score: 1, rated: true, weight: 1 },
  { difficulty: 1700, score: 0.2, rated: true, weight: 1 },
  { difficulty: 1300, score: 0.9, rated: true, weight: 1 },
];

async function sessionWithDecisions(userId: string): Promise<string> {
  const sessionId = await insertSessionRow(pool, { userId, mode: "automated" });
  const opens = tracks.opens ?? "";
  for (const [index, decision] of OPENS_DECISIONS.entries()) {
    await insertAttemptRow(pool, {
      userId,
      sessionId,
      solutionId,
      spotClassKey: CLASS,
      rated: true,
      score: decision.score,
      itemDifficulty: decision.difficulty,
      trackIds: [opens],
      createdAt: new Date(NOW.getTime() - (OPENS_DECISIONS.length - index) * 1000),
    });
  }
  // An unrated decision in another track moves nothing.
  await insertAttemptRow(pool, { userId, sessionId, solutionId, spotClassKey: CLASS, rated: false, itemDifficulty: 1500, trackIds: [tracks["facing-3bet"] ?? ""] });
  return sessionId;
}

async function ratingRow(userId: string, key: string) {
  const result = await pool.query("select mu, rd, volatility, updated_at from rating where user_id = $1 and track_id = $2", [userId, tracks[key]]);
  return result.rows[0] as { mu: number; rd: number; volatility: number; updated_at: Date } | undefined;
}

function expectRating(row: { mu: number; rd: number; volatility: number } | undefined, expected: TrackRating): void {
  expect(row?.mu).toBeCloseTo(expected.rating, 2);
  expect(row?.rd).toBeCloseTo(expected.rd, 3);
  expect(row?.volatility).toBeCloseTo(expected.volatility, 5);
}

describe("R4.11 session-end rating period", () => {
  it("R4.11 a first rated session rates its track from the new-track rating and writes one history row", async () => {
    const user = await createTestUser(database);
    const sessionId = await sessionWithDecisions(user.id);
    const changes = await rateSessionTracks(database, { userId: user.id, sessionId, now: NOW });
    const expected = rateSession(newTrackRating(), OPENS_DECISIONS);
    expectRating(await ratingRow(user.id, "opens"), expected);
    expect((await ratingRow(user.id, "opens"))?.updated_at).toEqual(NOW);
    expect(await ratingRow(user.id, "facing-3bet")).toBeUndefined();
    const history = await pool.query("select track_id, session_id, recorded_at from rating_history where user_id = $1", [user.id]);
    expect(history.rows).toEqual([{ track_id: tracks.opens, session_id: sessionId, recorded_at: NOW }]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ track_key: "opens", before: null });
    expect(changes[0]?.after.mu).toBeCloseTo(expected.rating, 2);
  });

  it("R4.11 a stored rating idle 21 days gets 3 empty periods before the session's period", async () => {
    const user = await createTestUser(database);
    const earlier = new Date(NOW.getTime() - IDLE_DAYS * DAY_MS);
    const previous = await insertSessionRow(pool, { userId: user.id, mode: "automated" });
    await pool.query("insert into rating (user_id, track_id, mu, rd, volatility, updated_at) values ($1, $2, 1620, 90, 0.06, $3)", [user.id, tracks.opens, earlier]);
    await pool.query(
      "insert into rating_history (user_id, track_id, session_id, mu, rd, volatility, recorded_at) values ($1, $2, $3, 1620, 90, 0.06, $4)",
      [user.id, tracks.opens, previous, earlier],
    );
    const sessionId = await sessionWithDecisions(user.id);
    const changes = await rateSessionTracks(database, { userId: user.id, sessionId, now: NOW });
    const storedVolatility = Number((await pool.query<{ v: number }>("select 0.06::real::float8 as v")).rows[0]?.v);
    const idle = applyInactivity({ rating: 1620, rd: 90, volatility: storedVolatility }, IDLE_PERIODS);
    expect(idle.rd).toBeGreaterThan(90);
    expectRating(await ratingRow(user.id, "opens"), rateSession(idle, OPENS_DECISIONS));
    expect(changes[0]?.before?.mu).toBeCloseTo(1620, 3);
    expect(changes[0]?.before?.rd).toBeCloseTo(idle.rd, 3);
  });

  it("R4.11 a track without rated decisions in the session is untouched", async () => {
    const user = await createTestUser(database);
    const earlier = new Date(NOW.getTime() - IDLE_DAYS * DAY_MS);
    await pool.query("insert into rating (user_id, track_id, mu, rd, volatility, updated_at) values ($1, $2, 1450, 120, 0.06, $3)", [user.id, tracks["blind-defense"], earlier]);
    const before = await ratingRow(user.id, "blind-defense");
    const sessionId = await sessionWithDecisions(user.id);
    await rateSessionTracks(database, { userId: user.id, sessionId, now: NOW });
    expect(await ratingRow(user.id, "blind-defense")).toEqual(before);
    const history = await pool.query<{ n: number }>("select count(*)::int as n from rating_history where user_id = $1 and track_id = $2", [
      user.id,
      tracks["blind-defense"],
    ]);
    expect(history.rows[0]?.n).toBe(0);
  });

  it("R4.11 a repeat call writes nothing and answers the same changes", async () => {
    const user = await createTestUser(database);
    const sessionId = await sessionWithDecisions(user.id);
    const first = await rateSessionTracks(database, { userId: user.id, sessionId, now: NOW });
    const rows = await learningRows(pool, user.id);
    const second = await rateSessionTracks(database, { userId: user.id, sessionId, now: new Date(NOW.getTime() + DAY_MS) });
    expect(second).toEqual(first);
    expect(await learningRows(pool, user.id)).toEqual(rows);
  });

  it("R4.11 a session without rated decisions changes no rating", async () => {
    const user = await createTestUser(database);
    const sessionId = await insertSessionRow(pool, { userId: user.id, mode: "automated" });
    await insertAttemptRow(pool, { userId: user.id, sessionId, solutionId, spotClassKey: CLASS, rated: false, trackIds: [tracks.opens ?? ""] });
    expect(await rateSessionTracks(database, { userId: user.id, sessionId, now: NOW })).toEqual([]);
    expect(await learningRows(pool, user.id)).toMatchObject({ rating: [], rating_history: [] });
  });
});
