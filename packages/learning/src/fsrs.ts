/**
 * FSRS (Free Spaced Repetition Scheduler) adapter over ts-fsrs (A6 section 1 row "FSRS
 * scheduling"; 06 section 4; ADR 0012). Owner: S30 (p4/learning), closing R4.6.
 *
 * Mechanism: one ts-fsrs card per spot class, keyed by spot_class_key (SpotClassCard, Deck). A
 * review's grade comes from the mean score over the instances served in that review and their
 * median response time (reviewGrade, gradeFromMean): Again under 0.4, Hard from 0.4, Good from
 * 0.7, and from 0.95 Easy only when the median is strictly under the class's typical time, else
 * Good; every threshold is inclusive at its lower edge (O-253). The scheduler is built per call
 * from FsrsOptions: request_retention is DESIRED_RETENTION 0.9 (06 section 4) unless the caller
 * passes retentionFor(true), 0.85 for a class BKT marks mastered, which spaces mastered classes
 * further apart without gating anything (06 section 5, O-253); default parameters and the default
 * short-term steps until enough reviews exist for fitting; fuzz always off, so a review is a
 * function of its arguments. overdueFactor, (1 - R(now)) / (1 - retention), is the queue's due
 * input: 1 at the due time, above 1 as recall decays, and 1 for a class never reviewed (O-254).
 *
 * Purity: ts-fsrs takes the review time as an argument (next(card, now, grade),
 * get_retrievability(card, now), next_state(state, elapsedDays, grade)), so the adapter passes the
 * time it is given and never reads a clock (A1 section 2). Every returned card is a fresh frozen
 * copy with its own Date objects, and no argument is mutated.
 *
 * License (O-35, ADR 0002): ts-fsrs 5.4.2 is MIT licensed; node_modules/ts-fsrs/LICENSE reads
 * "MIT License, Copyright (c) 2026 Open Spaced Repetition". Its published vectors are encoded in
 * test/R4.6-fsrs.test.ts with their source file and commit.
 */
import {
  FSRSVersion,
  Rating,
  State,
  checkParameters,
  createEmptyCard,
  default_enable_short_term,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import type { Card, FSRS, FSRSParameters, FSRSState, Grade } from "ts-fsrs";

import type { ModulePlaceholder } from "./types.js";
import { elementAt, isList, requireBoolean, requireNonNegative, requireOneOf } from "./validate.js";

/** The version string of the ts-fsrs build this adapter imports, for example "v5.4.2 using FSRS-6.0" (O-35). */
export const FSRS_LIBRARY_VERSION: string = FSRSVersion;

/** The four review grades of FSRS. */
export type FsrsGrade = "Again" | "Hard" | "Good" | "Easy";

/** Desired retention of every class not yet mastered (06 section 4). */
export const DESIRED_RETENTION = 0.9;

/** Retention of a class BKT marks mastered, the low end of 06 section 4's range (O-253). */
export const MASTERED_RETENTION = 0.85;

/** Lower edges of Hard, Good and Easy on the mean score, each inclusive (06 section 4, O-253). */
export const GRADE_THRESHOLDS = Object.freeze({ hard: 0.4, good: 0.7, easy: 0.95 });

/** Scheduler options; anything omitted takes the ts-fsrs default, retention DESIRED_RETENTION. */
export type FsrsOptions = Readonly<{ w?: readonly number[]; enableShortTerm?: boolean; requestRetention?: number }>;

/** The one card of a spot class. */
export type SpotClassCard = Readonly<{ spotClassKey: string; card: Card }>;

/** The cards of a hero, one per spot_class_key. */
export type Deck = Readonly<Record<string, SpotClassCard>>;

/** One review of the memory-state replay: its grade and the days since the previous review. */
export type MemoryStep = Readonly<{ grade: FsrsGrade; elapsedDays: number }>;

/** The scores and response times of the instances served in one review. */
export type ReviewOutcome = Readonly<{
  scores: readonly number[];
  responseMs: readonly number[];
  typicalResponseMs: number;
}>;

const FSRS_GRADES: readonly FsrsGrade[] = ["Again", "Hard", "Good", "Easy"];

const RATING_OF: Readonly<Record<FsrsGrade, Grade>> = Object.freeze({
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
});

/** Fuzz is always off so a review is a function of its arguments (O-253). */
const ENABLE_FUZZ = false;

function requireUnitScore(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be a number from 0 to 1, got ${String(value)}`);
  }
  return value;
}

function requireRetention(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError(`${field} must be a number strictly between 0 and 1, got ${String(value)}`);
  }
  return value;
}

function requireDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${field} must be a valid Date, got ${String(value)}`);
  }
  return value;
}

function requireKey(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${field} must be a non-empty string, got ${String(value)}`);
  }
  return value;
}

function requireWeights(w: readonly number[]): number[] {
  if (!isList(w) || !w.every((weight) => Number.isFinite(weight))) {
    throw new RangeError("options.w must be a list of finite numbers");
  }
  try {
    checkParameters(w);
  } catch (error: unknown) {
    throw new RangeError(`options.w is not a valid FSRS parameter vector (${String(error)})`);
  }
  return [...w];
}

/** The ts-fsrs parameters of the options, validated, with fuzz off. */
function parametersOf(options: FsrsOptions): FSRSParameters {
  const retention = options.requestRetention ?? DESIRED_RETENTION;
  const shortTerm = options.enableShortTerm ?? default_enable_short_term;
  return generatorParameters({
    request_retention: requireRetention(retention, "options.requestRetention"),
    enable_short_term: requireBoolean(shortTerm, "options.enableShortTerm"),
    enable_fuzz: ENABLE_FUZZ,
    ...(options.w === undefined ? {} : { w: requireWeights(options.w) }),
  });
}

function schedulerOf(options: FsrsOptions): FSRS {
  return fsrs(parametersOf(options));
}

/** A frozen copy of a card with its own Date objects. */
function copyCard(card: Card): Card {
  const lastReview = card.last_review;
  return Object.freeze({
    ...card,
    due: new Date(card.due.getTime()),
    ...(lastReview === undefined ? {} : { last_review: new Date(lastReview.getTime()) }),
  });
}

function ratingOf(grade: FsrsGrade, field: string): Grade {
  return RATING_OF[requireOneOf(grade, FSRS_GRADES, field)];
}

/** The FSRS grade of a mean score; Easy needs a median response faster than typical (06 section 4). */
export function gradeFromMean(meanScore: number, fasterThanTypical: boolean): FsrsGrade {
  const mean = requireUnitScore(meanScore, "meanScore");
  const faster = requireBoolean(fasterThanTypical, "fasterThanTypical");
  if (mean < GRADE_THRESHOLDS.hard) {
    return "Again";
  }
  if (mean < GRADE_THRESHOLDS.good) {
    return "Hard";
  }
  if (mean < GRADE_THRESHOLDS.easy || !faster) {
    return "Good";
  }
  return "Easy";
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = elementAt(sorted, middle, "responseMs");
  return sorted.length % 2 === 1 ? upper : (elementAt(sorted, middle - 1, "responseMs") + upper) / 2;
}

/**
 * The grade of one review: the mean of its scores, and faster than typical when the median
 * response time is strictly under typicalResponseMs (O-253). One response time per score.
 */
export function reviewGrade(outcome: ReviewOutcome): FsrsGrade {
  const { scores, responseMs, typicalResponseMs } = outcome;
  if (!isList(scores) || scores.length === 0) {
    throw new RangeError("scores must list at least one score");
  }
  scores.forEach((score, index) => requireUnitScore(score, `scores[${index}]`));
  if (!isList(responseMs) || responseMs.length !== scores.length) {
    throw new RangeError("responseMs must list one response time per score");
  }
  responseMs.forEach((time, index) => requireNonNegative(time, `responseMs[${index}]`));
  if (requireNonNegative(typicalResponseMs, "typicalResponseMs") === 0) {
    throw new RangeError("typicalResponseMs must be above 0, got 0");
  }
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return gradeFromMean(mean, medianOf(responseMs) < typicalResponseMs);
}

/** A never-reviewed card for a spot class, created at now. */
export function newSpotClassCard(spotClassKey: string, now: Date): SpotClassCard {
  const key = requireKey(spotClassKey, "spotClassKey");
  const created = createEmptyCard(new Date(requireDate(now, "now").getTime()));
  return Object.freeze({ spotClassKey: key, card: copyCard(created) });
}

/** The card after one review at now; a review before the card's last review is refused. */
export function reviewSpotClass(
  spotClassCard: SpotClassCard,
  grade: FsrsGrade,
  now: Date,
  options: FsrsOptions = {},
): SpotClassCard {
  const key = requireKey(spotClassCard.spotClassKey, "spotClassCard.spotClassKey");
  const at = requireDate(now, "now");
  const lastReview = spotClassCard.card.last_review;
  if (lastReview !== undefined && at.getTime() < lastReview.getTime()) {
    throw new RangeError("now must not be before the card's last review");
  }
  const rating = ratingOf(grade, "grade");
  const next = schedulerOf(options).next(spotClassCard.card, new Date(at.getTime()), rating);
  return Object.freeze({ spotClassKey: key, card: copyCard(next.card) });
}

/** A new deck with the class reviewed; a key not yet in the deck starts from newSpotClassCard. */
export function reviewInDeck(
  deck: Deck,
  spotClassKey: string,
  grade: FsrsGrade,
  now: Date,
  options: FsrsOptions = {},
): Deck {
  const key = requireKey(spotClassKey, "spotClassKey");
  const existing = Object.hasOwn(deck, key) ? deck[key] : undefined;
  if (existing !== undefined && existing.spotClassKey !== key) {
    throw new RangeError(`deck entry ${key} holds the card of ${existing.spotClassKey}`);
  }
  const reviewed = reviewSpotClass(existing ?? newSpotClassCard(key, now), grade, now, options);
  return Object.freeze({ ...deck, [key]: reviewed });
}

function nextState(scheduler: FSRS, state: FSRSState | null, step: MemoryStep, index: number): FSRSState {
  const elapsedDays = requireNonNegative(step.elapsedDays, `steps[${index}].elapsedDays`);
  return scheduler.next_state(state, elapsedDays, ratingOf(step.grade, `steps[${index}].grade`));
}

/** Stability and difficulty after replaying reviews from no memory, through ts-fsrs next_state. */
export function memoryState(
  steps: readonly MemoryStep[],
  options: FsrsOptions = {},
): Readonly<{ stability: number; difficulty: number }> {
  if (!isList(steps)) {
    throw new RangeError("steps must be a list of reviews");
  }
  const scheduler = schedulerOf(options);
  const initial = nextState(scheduler, null, elementAt(steps, 0, "steps"), 0);
  const final = steps.slice(1).reduce((state, step, index) => nextState(scheduler, state, step, index + 1), initial);
  return Object.freeze({ stability: final.stability, difficulty: final.difficulty });
}

/** Probability of recall at a time, from ts-fsrs get_retrievability; 0 for a never-reviewed card. */
export function retrievability(spotClassCard: SpotClassCard, at: Date, options: FsrsOptions = {}): number {
  const when = new Date(requireDate(at, "at").getTime());
  return schedulerOf(options).get_retrievability(spotClassCard.card, when, false);
}

/** The retention to schedule a class at: MASTERED_RETENTION when BKT marks it mastered (O-253). */
export function retentionFor(mastered: boolean): number {
  return requireBoolean(mastered, "mastered") ? MASTERED_RETENTION : DESIRED_RETENTION;
}

/** True when the card's due time is at or before now. */
export function isDue(spotClassCard: SpotClassCard, now: Date): boolean {
  return spotClassCard.card.due.getTime() <= requireDate(now, "now").getTime();
}

/**
 * Overdue factor (1 - R(now)) / (1 - retention) (O-254): 1 at the due time, above 1 as recall
 * decays, below 1 before due, and 1 for a class with no card or a card never reviewed.
 */
export function overdueFactor(
  spotClassCard: SpotClassCard | null,
  now: Date,
  retention: number = DESIRED_RETENTION,
  options: FsrsOptions = {},
): number {
  const target = requireRetention(retention, "retention");
  const at = requireDate(now, "now");
  if (spotClassCard === null || spotClassCard.card.state === State.New) {
    return 1;
  }
  return (1 - retrievability(spotClassCard, at, options)) / (1 - target);
}

/** Placeholder kept until the S30 integration step removes it from src/index.ts (R0.11). */
export const FSRS_MODULE: ModulePlaceholder = Object.freeze({
  module: "fsrs",
  responsibility: "FSRS scheduling per spot class over ts-fsrs, with the grade mapping from mean score",
  session: "S30",
  requirements: ["R4.6"],
});
