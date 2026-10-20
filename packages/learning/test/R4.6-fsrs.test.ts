/**
 * R4.6 FSRS (Free Spaced Repetition Scheduler) vectors (R0.11 red half; the green half is S30 on
 * p4/learning, src/fsrs.ts).
 *
 * License (O-35, ADR 0002): ts-fsrs 5.4.2 is MIT licensed. node_modules/ts-fsrs/LICENSE reads
 * "MIT License, Copyright (c) 2026 Open Spaced Repetition" and its package.json declares
 * "license": "MIT"; pnpm -r licenses list --json reports it under the MIT id (a root-only run does
 * not see workspace package dependencies).
 *
 * Vectors (O-35): the published test suite of ts-fsrs, file packages/fsrs/__tests__/FSRS-6.test.ts
 * at tag v5.4.2 (commit bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d) of
 * https://github.com/open-spaced-repetition/ts-fsrs. The npm tarball ships only dist/, so the
 * vectors are copied here as data; the suite itself cites fsrs-rs (src/inference.rs) for the
 * memory-state numbers. Four vectors are encoded: the 13-review interval history, the six-review
 * memory state, the four first-repeat cards, and the retrievability of a card reviewed five minutes
 * after creation under the default parameters.
 *
 * Purity: ts-fsrs takes the review time as an argument (repeat(card, now), next(card, now, grade),
 * next_state(state, elapsedDays, grade)), so the adapter passes the time it is given and never
 * reads a clock (A1 section 2).
 */
import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";
import { describe, expect, it } from "vitest";

export const TS_FSRS_VERSION = "5.4.2";
export const TS_FSRS_LICENSE = "MIT";
export const TS_FSRS_VECTOR_SOURCE = Object.freeze({
  repository: "https://github.com/open-spaced-repetition/ts-fsrs",
  file: "packages/fsrs/__tests__/FSRS-6.test.ts",
  tag: "v5.4.2",
  commit: "bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d",
});

export type FsrsGradeName = "Again" | "Hard" | "Good" | "Easy";

/** The ts-fsrs Rating enum values of the four grades, in grade order. */
export const FSRS_RATING_BY_NAME: Readonly<Record<FsrsGradeName, number>> = Object.freeze({
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
});

/** FSRS-6 parameter vector w of the published suite (21 weights). */
export const FSRS6_PUBLISHED_W: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

/**
 * Published vector 1, interval history. Start at 2022-12-29 12:30:00 local time (the suite builds
 * it as new Date(2022, 11, 29, 12, 30, 0, 0)); each review happens at the card's due time; the
 * value recorded after each review is card.scheduled_days.
 */
export const FSRS6_INTERVAL_HISTORY_VECTOR = Object.freeze({
  start: { year: 2022, monthIndex: 11, day: 29, hour: 12, minute: 30 },
  ratings: [
    "Good", "Good", "Good", "Good", "Good", "Good", "Again", "Again", "Good", "Good", "Good", "Good", "Good",
  ] satisfies FsrsGradeName[],
  expectedScheduledDays: [0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21],
});

/** Published vector 2, memory state after six reviews at the given elapsed days since the previous one. */
export const FSRS6_MEMORY_STATE_VECTOR = Object.freeze({
  steps: [
    { rating: "Again", elapsedDays: 0 },
    { rating: "Good", elapsedDays: 0 },
    { rating: "Good", elapsedDays: 1 },
    { rating: "Good", elapsedDays: 3 },
    { rating: "Good", elapsedDays: 8 },
    { rating: "Good", elapsedDays: 21 },
  ] satisfies { rating: FsrsGradeName; elapsedDays: number }[],
  expected: {
    shortTerm: { stability: 53.62691, difficulty: 6.3574867 },
    longTerm: { stability: 53.335106, difficulty: 6.3574867 },
  },
  decimalPlaces: 4,
});

/** Published vector 3, the four cards of the first repeat of an empty card, in grade order Again, Hard, Good, Easy. */
export const FSRS6_FIRST_REPEAT_VECTOR = Object.freeze({
  grades: ["Again", "Hard", "Good", "Easy"] satisfies FsrsGradeName[],
  stability: [0.212, 1.2931, 2.3065, 8.2956],
  difficulty: [6.4133, 5.11217071, 2.11810397, 1],
  scheduledDays: [0, 0, 0, 8],
  elapsedDays: [0, 0, 0, 0],
  reps: [1, 1, 1, 1],
  lapses: [0, 0, 0, 0],
  states: [State.Learning, State.Learning, State.Learning, State.Review],
});

/** Published vector 4, default parameters: retrievability at each grade's due time after a review five minutes after creation. */
export const FSRS_DEFAULT_RETRIEVABILITY_VECTOR = Object.freeze({
  created: "2023-12-01 04:00:00",
  reviewed: "2023-12-01 04:05:00",
  expectedAtDue: [1, 1, 1, 0.9024733],
  expectedAtDueFormatted: ["100.00%", "100.00%", "100.00%", "90.25%"],
});

/**
 * Grade mapping of 06 section 4 from the mean score s over the review's instances and the median
 * response time. Thresholds are read as inclusive at the lower edge (0.4 is Hard, 0.7 is Good,
 * 0.95 is Easy when fast); S30 confirms or amends that reading in the same row.
 */
export const FSRS_GRADE_MAPPING = Object.freeze({
  desiredRetention: 0.9,
  thresholds: { hard: 0.4, good: 0.7, easy: 0.95 },
  rows: [
    { meanScore: 0, fasterThanTypical: true, expected: "Again" },
    { meanScore: 0.39, fasterThanTypical: true, expected: "Again" },
    { meanScore: 0.4, fasterThanTypical: false, expected: "Hard" },
    { meanScore: 0.69, fasterThanTypical: true, expected: "Hard" },
    { meanScore: 0.7, fasterThanTypical: false, expected: "Good" },
    { meanScore: 0.94, fasterThanTypical: true, expected: "Good" },
    { meanScore: 0.95, fasterThanTypical: false, expected: "Good" },
    { meanScore: 0.95, fasterThanTypical: true, expected: "Easy" },
    { meanScore: 1, fasterThanTypical: true, expected: "Easy" },
  ] satisfies { meanScore: number; fasterThanTypical: boolean; expected: FsrsGradeName }[],
});

describe("R4.6 FSRS adapter over ts-fsrs (S30, ADR 0012, O-35)", () => {
  it("R0.11 ts-fsrs resolves and the transcribed memory-state vector matches the library directly (transcription check, not the adapter)", () => {
    expect(typeof fsrs).toBe("function");
    expect(createEmptyCard().state).toBe(State.New);
    expect(FSRS6_PUBLISHED_W).toHaveLength(21);
    expect(FSRS6_INTERVAL_HISTORY_VECTOR.ratings).toHaveLength(
      FSRS6_INTERVAL_HISTORY_VECTOR.expectedScheduledDays.length,
    );
    expect(FSRS_GRADE_MAPPING.desiredRetention).toBe(0.9);

    const scheduler = fsrs({ w: [...FSRS6_PUBLISHED_W], enable_short_term: true });
    const finalState = FSRS6_MEMORY_STATE_VECTOR.steps.reduce(
      (state, step) => scheduler.next_state(state, step.elapsedDays, FSRS_RATING_BY_NAME[step.rating]),
      null as ReturnType<typeof scheduler.next_state> | null,
    );
    expect(finalState?.stability).toBeCloseTo(
      FSRS6_MEMORY_STATE_VECTOR.expected.shortTerm.stability,
      FSRS6_MEMORY_STATE_VECTOR.decimalPlaces,
    );
    expect(finalState?.difficulty).toBeCloseTo(
      FSRS6_MEMORY_STATE_VECTOR.expected.shortTerm.difficulty,
      FSRS6_MEMORY_STATE_VECTOR.decimalPlaces,
    );
  });

  it.todo(
    "R4.6 ts-fsrs license verified: the adapter wraps ts-fsrs 5.4.2 under the MIT License (O-35, ADR 0002)",
  );
  it.todo(
    "R4.6 published interval history through the adapter: 13 reviews at due time with the FSRS-6 w give scheduled days [0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21]",
  );
  it.todo(
    "R4.6 published memory state (short-term) through the adapter: Again then five Good at elapsed days [0, 0, 1, 3, 8, 21] give stability 53.62691 and difficulty 6.3574867",
  );
  it.todo(
    "R4.6 published memory state (long-term) through the adapter: the same reviews with short-term steps off give stability 53.335106 and difficulty 6.3574867",
  );
  it.todo(
    "R4.6 published first repeat through the adapter: stability [0.212, 1.2931, 2.3065, 8.2956], difficulty [6.4133, 5.11217071, 2.11810397, 1], scheduled days [0, 0, 0, 8], states Learning x3 then Review",
  );
  it.todo(
    "R4.6 published retrievability under default parameters: a card reviewed five minutes after creation has retrievability [1, 1, 1, 0.9024733] at each grade's due time",
  );
  it.todo(
    "R4.6 grade mapping table: mean score under 0.4 Again, 0.4 to 0.7 Hard, 0.7 to 0.95 Good, 0.95 or more and faster than the class's typical time Easy, otherwise Good (06 section 4)",
  );
  it.todo("R4.6 desired retention 0.9 is passed to ts-fsrs as request_retention (06 section 4)");
  it.todo("R4.6 one card per spot class: the adapter keys cards by spot_class_key and keeps one card per key");
  it.todo(
    "R4.6 the adapter never reads a clock: the review time is an argument and two calls with the same arguments return equal cards (A1 section 2)",
  );
  it.todo("R4.6 the adapter returns a new card and never mutates the card it was given");
});
