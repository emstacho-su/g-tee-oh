/**
 * The automated loop's rated rules in api (R4.10, O-274, O-272, the PM seed condition): the facts
 * learning's grade() needs that only the database knows, turned into GradeOverrides. Pure; the
 * automated hook part (automated/effects.ts) reads the facts and calls this.
 *
 * - mode automated: the only mode grade() may rate (A6 section 4).
 * - firstAttempt: true only when the user has no earlier attempt at the item, the (solution, node,
 *   hand class) triple, in any mode (O-274, attempt_item_idx). Strict: a retry never rates again.
 * - panelsRevealed: a worked-example block shows every panel, so its decisions are unrated (O-272);
 *   other blocks hide the answer-revealing panels.
 * - ratedTodayInTrack: the user's rated attempts today in the class's track (O-274, O-247), which
 *   grade()'s daily cap reads; absent (the S23 per-user count) for a class no track takes.
 * - forceUnrated: a session created with a client-supplied seed is unrated end to end, since a
 *   chosen seed and a pure GET /next let its hands be previewed (PM seed condition). decide.ts's one
 *   post-grade step applies it.
 */
import type { GradeOverrides } from "./effects.js";

export const AUTOMATED_GRADE_MODE = "automated";

export interface AutomatedRatingFacts {
  /** The session was created with a client-supplied seed. */
  seeded: boolean;
  /** The block is a worked example (a first exposure). */
  workedExample: boolean;
  /** The user's attempts at this (solution, node, hand class) before this decision. */
  earlierAttemptsAtItem: number;
  /** Rated attempts today in the class's track; null when the class has no track. */
  ratedTodayInTrack: number | null;
}

/** First attempt means no earlier attempt at the item, in any mode (O-274). */
export function isFirstAttempt(earlierAttemptsAtItem: number): boolean {
  if (!Number.isInteger(earlierAttemptsAtItem) || earlierAttemptsAtItem < 0) {
    throw new RangeError(`earlier attempts must be a non-negative integer, got ${earlierAttemptsAtItem}`);
  }
  return earlierAttemptsAtItem === 0;
}

/** The GradeOverrides of one automated decision (see the module doc). */
export function automatedGradeOverrides(facts: AutomatedRatingFacts): GradeOverrides {
  return {
    mode: AUTOMATED_GRADE_MODE,
    firstAttempt: isFirstAttempt(facts.earlierAttemptsAtItem),
    panelsRevealed: facts.workedExample,
    ...(facts.ratedTodayInTrack === null ? {} : { ratedTodayInTrack: facts.ratedTodayInTrack }),
    ...(facts.seeded ? { forceUnrated: true } : {}),
  };
}
