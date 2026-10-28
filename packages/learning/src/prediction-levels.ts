/**
 * Prediction levels (R3.16, O-301, 05 section 8): which level of a prediction ladder a user is at
 * for one spot class, and whether the latest answer unlocked the next one.
 *
 * Mechanism: the answers of one (spot class, ladder) are replayed in time order from level 1.
 * Only answers recorded at the level the replay is at count toward it; after each one, when the
 * most recent PREDICTION_WINDOW of them hold at least PREDICTION_UNLOCK_PCT percent correct (and
 * there are at least PREDICTION_WINDOW), the replay moves up one level, up to
 * MAX_PREDICTION_LEVEL. The result names the final level, the window the latest answer was
 * judged in (its level's last answers, at most PREDICTION_WINDOW) and whether that latest answer
 * was the one that crossed. An unlock changes difficulty only: no content, score or reward
 * (05 section 8). The percentage test is done in integers (correct x 100 against the required
 * percent x the window), so no rounding can move the boundary. Pure: no I/O, clock or randomness.
 */

/** Answers a level's unlock looks back over, and the minimum before any unlock (O-301). */
export const PREDICTION_WINDOW = 20;
/** The percent of the window that must be correct to unlock the next level (O-301). */
export const PREDICTION_UNLOCK_PCT = 90;
/** The highest level of each ladder (O-301). */
export const MAX_PREDICTION_LEVEL = 3;

const FIRST_LEVEL = 1;
const PERCENT = 100;

export type PredictionLadder = "range" | "hand";

/** The (spot class, ladder) a level belongs to; levels are never shared across either. */
export interface PredictionLadderKey {
  spotClassKey: string;
  ladder: PredictionLadder;
}

/** One stored answer: its spot class, ladder, the level it was asked at and whether it was right. */
export interface PredictionAnswerRecord extends PredictionLadderKey {
  level: number;
  correct: boolean;
}

export interface PredictionWindow {
  /** Answers counted at the level, at most `size`. */
  answers: number;
  correct: number;
  size: number;
  required_pct: number;
}

export interface PredictionLevel {
  /** The ladder's level after the latest answer. */
  level: number;
  /** The window the latest answer was judged in (the current level's when there is no answer). */
  window: PredictionWindow;
  /** True when the latest answer is the one that unlocked the level. */
  unlockedNow: boolean;
}

function requireLevel(level: number): number {
  if (!Number.isInteger(level) || level < FIRST_LEVEL || level > MAX_PREDICTION_LEVEL) {
    throw new RangeError(`prediction level ${level} is outside ${FIRST_LEVEL} to ${MAX_PREDICTION_LEVEL}`);
  }
  return level;
}

function windowOf(recent: readonly boolean[]): PredictionWindow {
  const counted = recent.slice(-PREDICTION_WINDOW);
  return {
    answers: counted.length,
    correct: counted.filter(Boolean).length,
    size: PREDICTION_WINDOW,
    required_pct: PREDICTION_UNLOCK_PCT,
  };
}

/** True when a full window holds at least the required percent correct. */
export function windowUnlocks(window: PredictionWindow): boolean {
  return window.answers >= PREDICTION_WINDOW && window.correct * PERCENT >= PREDICTION_UNLOCK_PCT * PREDICTION_WINDOW;
}

function sameLadder(record: PredictionAnswerRecord, key: PredictionLadderKey): boolean {
  return record.spotClassKey === key.spotClassKey && record.ladder === key.ladder;
}

/** The level of `key`'s ladder after replaying `history` (time order, oldest first). */
export function levelFor(history: readonly PredictionAnswerRecord[], key: PredictionLadderKey): PredictionLevel {
  let level = FIRST_LEVEL;
  let atLevel: readonly boolean[] = [];
  let result: PredictionLevel = { level, window: windowOf([]), unlockedNow: false };
  for (const record of history.filter((entry) => sameLadder(entry, key))) {
    if (requireLevel(record.level) !== level) {
      result = { level, window: windowOf(atLevel), unlockedNow: false };
      continue;
    }
    atLevel = [...atLevel, record.correct];
    const window = windowOf(atLevel);
    const unlocks = level < MAX_PREDICTION_LEVEL && windowUnlocks(window);
    if (unlocks) {
      level += 1;
      atLevel = [];
    }
    result = { level, window, unlockedNow: unlocks };
  }
  return result;
}
