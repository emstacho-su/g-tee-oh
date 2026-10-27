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
import type { Card } from "ts-fsrs";
import { describe, expect, it, vi } from "vitest";

import {
  DESIRED_RETENTION,
  FSRS_LIBRARY_VERSION,
  GRADE_THRESHOLDS,
  MASTERED_RETENTION,
  gradeFromMean,
  isDue,
  memoryState,
  newSpotClassCard,
  overdueFactor,
  retentionFor,
  retrievability,
  reviewGrade,
  reviewInDeck,
  reviewSpotClass,
} from "../src/fsrs.js";
import type { Deck, FsrsGrade, FsrsOptions, MemoryStep, SpotClassCard } from "../src/fsrs.js";

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

  const KEY = "rfi/CO/100bb/online";
  const OTHER_KEY = "facing-open/BTN-vs-CO/100bb/online";
  const PUBLISHED_OPTIONS: FsrsOptions = { w: FSRS6_PUBLISHED_W, enableShortTerm: true };
  const FIXED_TIME = new Date(Date.UTC(2026, 9, 20, 12, 0, 0));
  const DAY_MS = 86_400_000;

  /** A card in the Review state: Easy on a new card, then Good at its due time. */
  function reviewStateCard(options?: FsrsOptions): SpotClassCard {
    const easy = reviewSpotClass(newSpotClassCard(KEY, FIXED_TIME), "Easy", FIXED_TIME, options);
    return reviewSpotClass(easy, "Good", easy.card.due, options);
  }

  it("R4.6 ts-fsrs license verified: the adapter wraps ts-fsrs 5.4.2 under the MIT License (O-35, ADR 0002)", () => {
    expect(TS_FSRS_VERSION).toBe("5.4.2");
    expect(TS_FSRS_LICENSE).toBe("MIT");
    expect(TS_FSRS_VECTOR_SOURCE.tag).toBe(`v${TS_FSRS_VERSION}`);
    // The version string the adapter's own ts-fsrs import reports, for example "v5.4.2 using FSRS-6.0".
    expect(FSRS_LIBRARY_VERSION.startsWith(`v${TS_FSRS_VERSION} `)).toBe(true);
    expect(newSpotClassCard(KEY, FIXED_TIME).card.state).toBe(State.New);
  });

  it("R4.6 published interval history through the adapter: 13 reviews at due time with the FSRS-6 w give scheduled days [0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21]", () => {
    const { start, ratings, expectedScheduledDays } = FSRS6_INTERVAL_HISTORY_VECTOR;
    const created = new Date(start.year, start.monthIndex, start.day, start.hour, start.minute, 0, 0);
    const history = ratings.reduce<{ card: SpotClassCard; days: number[] }>(
      (run, grade) => {
        const next = reviewSpotClass(run.card, grade, run.card.card.due, PUBLISHED_OPTIONS);
        return { card: next, days: [...run.days, next.card.scheduled_days] };
      },
      { card: newSpotClassCard(KEY, created), days: [] },
    );
    expect(history.days).toEqual(expectedScheduledDays);
  });

  it("R4.6 published memory state (short-term) through the adapter: Again then five Good at elapsed days [0, 0, 1, 3, 8, 21] give stability 53.62691 and difficulty 6.3574867", () => {
    const steps = FSRS6_MEMORY_STATE_VECTOR.steps.map((step) => ({ grade: step.rating, elapsedDays: step.elapsedDays }));
    const state = memoryState(steps, PUBLISHED_OPTIONS);
    const { expected, decimalPlaces } = FSRS6_MEMORY_STATE_VECTOR;
    expect(state.stability).toBeCloseTo(expected.shortTerm.stability, decimalPlaces);
    expect(state.difficulty).toBeCloseTo(expected.shortTerm.difficulty, decimalPlaces);
  });

  it("R4.6 published memory state (long-term) through the adapter: the same reviews with short-term steps off give stability 53.335106 and difficulty 6.3574867", () => {
    const steps = FSRS6_MEMORY_STATE_VECTOR.steps.map((step) => ({ grade: step.rating, elapsedDays: step.elapsedDays }));
    const state = memoryState(steps, { ...PUBLISHED_OPTIONS, enableShortTerm: false });
    const { expected, decimalPlaces } = FSRS6_MEMORY_STATE_VECTOR;
    expect(state.stability).toBeCloseTo(expected.longTerm.stability, decimalPlaces);
    expect(state.difficulty).toBeCloseTo(expected.longTerm.difficulty, decimalPlaces);
  });

  it("R4.6 published first repeat through the adapter: stability [0.212, 1.2931, 2.3065, 8.2956], difficulty [6.4133, 5.11217071, 2.11810397, 1], scheduled days [0, 0, 0, 8], states Learning x3 then Review", () => {
    const vector = FSRS6_FIRST_REPEAT_VECTOR;
    vector.grades.forEach((grade, index) => {
      const { card } = reviewSpotClass(newSpotClassCard(KEY, FIXED_TIME), grade, FIXED_TIME, PUBLISHED_OPTIONS);
      expect(card.stability).toBeCloseTo(vector.stability[index] ?? Number.NaN, 8);
      expect(card.difficulty).toBeCloseTo(vector.difficulty[index] ?? Number.NaN, 8);
      expect(card.scheduled_days).toBe(vector.scheduledDays[index]);
      expect(card.elapsed_days).toBe(vector.elapsedDays[index]);
      expect(card.reps).toBe(vector.reps[index]);
      expect(card.lapses).toBe(vector.lapses[index]);
      expect(card.state).toBe(vector.states[index]);
    });
  });

  it("R4.6 published retrievability under default parameters: a card reviewed five minutes after creation has retrievability [1, 1, 1, 0.9024733] at each grade's due time", () => {
    const vector = FSRS_DEFAULT_RETRIEVABILITY_VECTOR;
    const created = newSpotClassCard(KEY, new Date(vector.created));
    const reviewed = new Date(vector.reviewed);
    FSRS6_FIRST_REPEAT_VECTOR.grades.forEach((grade, index) => {
      const card = reviewSpotClass(created, grade, reviewed);
      expect(retrievability(card, card.card.due)).toBeCloseTo(vector.expectedAtDue[index] ?? Number.NaN, 7);
    });
  });

  it("R4.6 grade mapping table: mean score under 0.4 Again, 0.4 to 0.7 Hard, 0.7 to 0.95 Good, 0.95 or more and faster than the class's typical time Easy, otherwise Good (06 section 4)", () => {
    expect(GRADE_THRESHOLDS).toEqual(FSRS_GRADE_MAPPING.thresholds);
    for (const row of FSRS_GRADE_MAPPING.rows) {
      expect(gradeFromMean(row.meanScore, row.fasterThanTypical)).toBe(row.expected);
    }
    // reviewGrade: the mean of the scores and the median response time, faster strictly under typical.
    const perfect = { scores: [1, 0.9, 1], responseMs: [800, 1200, 900] };
    expect(reviewGrade({ ...perfect, typicalResponseMs: 1000 })).toBe("Easy");
    expect(reviewGrade({ ...perfect, typicalResponseMs: 900 })).toBe("Good");
    expect(reviewGrade({ scores: [1, 1], responseMs: [100, 300], typicalResponseMs: 200 })).toBe("Good");
    expect(reviewGrade({ scores: [1, 1], responseMs: [100, 300], typicalResponseMs: 201 })).toBe("Easy");
    expect(reviewGrade({ scores: [0.3, 0.5], responseMs: [1, 1], typicalResponseMs: 1000 })).toBe("Hard");
    expect(reviewGrade({ scores: [0, 0.2], responseMs: [1, 1], typicalResponseMs: 1000 })).toBe("Again");
  });

  it("R4.6 desired retention 0.9 is passed to ts-fsrs as request_retention (06 section 4)", () => {
    expect(DESIRED_RETENTION).toBe(FSRS_GRADE_MAPPING.desiredRetention);
    expect(MASTERED_RETENTION).toBe(0.85);
    expect(retentionFor(false)).toBe(DESIRED_RETENTION);
    expect(retentionFor(true)).toBe(MASTERED_RETENTION);
    const card = reviewStateCard();
    const at = card.card.due;
    const direct = (retention: number): Card =>
      fsrs({ request_retention: retention, enable_fuzz: false }).next(card.card, at, Rating.Good).card;
    expect(reviewSpotClass(card, "Good", at).card).toEqual(direct(0.9));
    const mastered = reviewSpotClass(card, "Good", at, { requestRetention: retentionFor(true) });
    expect(mastered.card).toEqual(direct(MASTERED_RETENTION));
    expect(mastered.card.scheduled_days).toBeGreaterThan(reviewSpotClass(card, "Good", at).card.scheduled_days);
    expect(() => retentionFor("yes" as unknown as boolean)).toThrow(/mastered/);
  });

  it("R4.6 one card per spot class: the adapter keys cards by spot_class_key and keeps one card per key", () => {
    const empty: Deck = {};
    const once = reviewInDeck(empty, KEY, "Good", FIXED_TIME);
    expect(Object.keys(once)).toEqual([KEY]);
    expect(once[KEY]?.spotClassKey).toBe(KEY);
    const twice = reviewInDeck(once, KEY, "Good", once[KEY]?.card.due ?? FIXED_TIME);
    expect(Object.keys(twice)).toEqual([KEY]);
    expect(twice[KEY]?.card.reps).toBe(2);
    const both = reviewInDeck(twice, OTHER_KEY, "Again", FIXED_TIME);
    expect(Object.keys(both).sort()).toEqual([KEY, OTHER_KEY].sort());
    expect(both[OTHER_KEY]?.card.reps).toBe(1);
    expect(empty).toEqual({});
    expect(Object.keys(once)).toEqual([KEY]);
    // A key that names an Object prototype member is still a new class, not an inherited value.
    const prototypeKey: string = "constructor";
    expect(reviewInDeck(empty, prototypeKey, "Good", FIXED_TIME)[prototypeKey]?.card.reps).toBe(1);
    const mislabeled: Deck = { [KEY]: newSpotClassCard(OTHER_KEY, FIXED_TIME) };
    expect(() => reviewInDeck(mislabeled, KEY, "Good", FIXED_TIME)).toThrow(/deck/);
  });

  it("R4.6 the adapter never reads a clock: the review time is an argument and two calls with the same arguments return equal cards (A1 section 2)", () => {
    const run = (): SpotClassCard => reviewSpotClass(reviewStateCard(), "Hard", new Date(FIXED_TIME.getTime() + 30 * DAY_MS));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.UTC(2001, 0, 1)));
      const early = run();
      const earlyR = retrievability(early, FIXED_TIME);
      vi.setSystemTime(new Date(Date.UTC(2041, 0, 1)));
      expect(run()).toEqual(early);
      expect(retrievability(early, FIXED_TIME)).toBe(earlyR);
    } finally {
      vi.useRealTimers();
    }
    expect(run()).toEqual(run());
  });

  it("R4.6 the adapter returns a new card and never mutates the card it was given", () => {
    const original = reviewStateCard();
    const frozen: SpotClassCard = Object.freeze({ ...original, card: Object.freeze({ ...original.card }) });
    const snapshot = JSON.stringify(frozen);
    const reviewed = reviewSpotClass(frozen, "Again", frozen.card.due);
    expect(reviewed).not.toBe(frozen);
    expect(reviewed.card).not.toBe(frozen.card);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(Object.isFrozen(reviewed)).toBe(true);
    expect(Object.isFrozen(reviewed.card)).toBe(true);
    expect(reviewed.card.due).not.toBe(frozen.card.due);
    const deck: Deck = Object.freeze({ [KEY]: frozen });
    const next = reviewInDeck(deck, KEY, "Good", frozen.card.due);
    expect(Object.isFrozen(next)).toBe(true);
    expect(deck[KEY]).toBe(frozen);
  });

  it("R4.6 overdue factor (1 - R) / (1 - retention): 1 for a never-reviewed class, under 1 before due, above 1 well past due (O-254)", () => {
    expect(overdueFactor(null, FIXED_TIME)).toBe(1);
    expect(overdueFactor(newSpotClassCard(KEY, FIXED_TIME), FIXED_TIME)).toBe(1);
    const card = reviewStateCard();
    const due = card.card.due;
    const atDue = overdueFactor(card, due);
    expect(atDue).toBeCloseTo((1 - retrievability(card, due)) / (1 - DESIRED_RETENTION), 12);
    expect(atDue).toBeGreaterThan(0.9);
    expect(atDue).toBeLessThan(1.1);
    expect(overdueFactor(card, card.card.last_review ?? FIXED_TIME)).toBe(0);
    expect(overdueFactor(card, new Date(due.getTime() + 60 * DAY_MS))).toBeGreaterThan(1);
    const masteredFactor = overdueFactor(card, due, MASTERED_RETENTION);
    expect(masteredFactor).toBeCloseTo((1 - retrievability(card, due)) / (1 - MASTERED_RETENTION), 12);
    expect(masteredFactor).toBeLessThan(atDue);
    expect(isDue(card, due)).toBe(true);
    expect(isDue(card, new Date(due.getTime() - 1))).toBe(false);
    expect(retrievability(newSpotClassCard(KEY, FIXED_TIME), FIXED_TIME)).toBe(0);
  });

  it("R4.6 invalid input throws a RangeError naming the field", () => {
    const card = reviewStateCard();
    expect(() => gradeFromMean(1.1, true)).toThrow(/meanScore/);
    expect(() => gradeFromMean(Number.NaN, true)).toThrow(/meanScore/);
    expect(() => gradeFromMean(0.5, 1 as unknown as boolean)).toThrow(/fasterThanTypical/);
    expect(() => reviewGrade({ scores: [], responseMs: [], typicalResponseMs: 1 })).toThrow(/scores/);
    expect(() => reviewGrade({ scores: [-0.1], responseMs: [1], typicalResponseMs: 1 })).toThrow(/scores\[0\]/);
    expect(() => reviewGrade({ scores: [1], responseMs: [1, 2], typicalResponseMs: 1 })).toThrow(/responseMs/);
    expect(() => reviewGrade({ scores: [1], responseMs: [-1], typicalResponseMs: 1 })).toThrow(/responseMs\[0\]/);
    expect(() => reviewGrade({ scores: [1], responseMs: [1], typicalResponseMs: 0 })).toThrow(/typicalResponseMs/);
    expect(() => reviewGrade({ scores: "1" as unknown as number[], responseMs: [1], typicalResponseMs: 1 })).toThrow(
      /scores/,
    );
    expect(() => newSpotClassCard("", FIXED_TIME)).toThrow(/spotClassKey/);
    expect(() => newSpotClassCard(KEY, new Date(Number.NaN))).toThrow(/now/);
    expect(() => newSpotClassCard(KEY, "2026-10-20" as unknown as Date)).toThrow(/now/);
    expect(() => reviewSpotClass(card, "Perfect" as FsrsGrade, card.card.due)).toThrow(/grade/);
    const lastReview = card.card.last_review ?? FIXED_TIME;
    expect(() => reviewSpotClass(card, "Good", new Date(lastReview.getTime() - 1))).toThrow(/now/);
    expect(() => reviewSpotClass(card, "Good", card.card.due, { requestRetention: 1 })).toThrow(
      /options\.requestRetention/,
    );
    expect(() => reviewSpotClass(card, "Good", card.card.due, { requestRetention: 0 })).toThrow(
      /options\.requestRetention/,
    );
    expect(() => reviewSpotClass(card, "Good", card.card.due, { enableShortTerm: 1 as unknown as boolean })).toThrow(
      /options\.enableShortTerm/,
    );
    expect(() => reviewSpotClass(card, "Good", card.card.due, { w: [1, 2] })).toThrow(/options\.w/);
    expect(() => reviewSpotClass(card, "Good", card.card.due, { w: FSRS6_PUBLISHED_W.map(() => Number.NaN) })).toThrow(
      /options\.w/,
    );
    expect(() => memoryState([])).toThrow(/steps/);
    expect(() => memoryState("Good" as unknown as MemoryStep[])).toThrow(/steps/);
    expect(() => memoryState([{ grade: "Good", elapsedDays: -1 }])).toThrow(/steps\[0\]\.elapsedDays/);
    expect(() => memoryState([{ grade: "Fine" as FsrsGrade, elapsedDays: 0 }])).toThrow(/steps\[0\]\.grade/);
    expect(() => retrievability(card, new Date(Number.NaN))).toThrow(/at/);
    expect(() => overdueFactor(card, FIXED_TIME, 1)).toThrow(/retention/);
    expect(() => isDue(card, new Date(Number.NaN))).toThrow(/now/);
  });
});
