/**
 * The Goodhart flag (R4.13, O-277, 06 section 9): a rating that rises while the holdout score stays
 * flat is being gamed or overfit, so the round's close flags the track. Pure.
 *
 * Rule: at a round's close, per track, compare this round with the previous closed round. Both need
 * at least GOODHART_MIN_ANSWERED answered items (fewer is noise, never a flag). The flag is set when
 * the track's mu rose by GOODHART_MU_RISE or more and the holdout mean score rose by
 * GOODHART_MAX_SCORE_RISE or less (a fall counts as "not risen").
 */

/** Answered items each round needs before the rule speaks (O-277). */
export const GOODHART_MIN_ANSWERED = 20;
/** A rating rise at least this large is a real rise (O-277). */
export const GOODHART_MU_RISE = 50;
/** A holdout mean-score rise at most this large is flat (O-277). */
export const GOODHART_MAX_SCORE_RISE = 0.02;
/** Stored scores and ratings are real (float4) columns: a difference at the threshold lands on it. */
const COMPARE_EPSILON = 1e-6;

/** One track's figures at a round's close. */
export interface RoundFigures {
  answered: number;
  meanScore: number | null;
  mu: number | null;
}

/** True when the track's rating rose while its holdout score stayed flat (O-277). */
export function goodhartFlag(previous: RoundFigures | null, current: RoundFigures): boolean {
  if (previous === null) {
    return false;
  }
  if (previous.answered < GOODHART_MIN_ANSWERED || current.answered < GOODHART_MIN_ANSWERED) {
    return false;
  }
  if (previous.mu === null || current.mu === null || previous.meanScore === null || current.meanScore === null) {
    return false;
  }
  const muRose = current.mu - previous.mu >= GOODHART_MU_RISE - COMPARE_EPSILON;
  const scoreFlat = current.meanScore - previous.meanScore <= GOODHART_MAX_SCORE_RISE + COMPARE_EPSILON;
  return muRose && scoreFlat;
}
