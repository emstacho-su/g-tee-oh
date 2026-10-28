/**
 * Synthetic automated-training fixtures typed against the S31 contract (S32, R4.10, R4.12, O-26,
 * O-272, O-325, O-328). The /train tests, the mocked session route and the screenshots read these.
 * Every value is made up: the classes are cells of the synthetic progress heat map
 * (fixtures/progress.ts), the hands are the trainer fixture's, and nothing comes from a real
 * solution, rating or reference tool.
 *
 * - Two automated blocks of BLOCK_SIZE hands: a rated one (a class the learner has practiced) and a
 *   worked example (a first exposure, unrated, every panel visible).
 * - A holdout retest session with its round progress.
 * - Two recaps: one with rated decisions, a rating change per track (one track new), a tier held
 *   below its band and an unlock; one with nothing rated.
 */
import type { AutomatedBlock, HoldoutProgress, PracticeSession, SessionRecap } from "../trainer/session-types.js";
import type { TrainerPrompt } from "../contracts.js";
import { FIXTURE_HEATMAP_COLUMNS, FIXTURE_HEATMAP_ROWS, fixtureClassKey } from "./progress.js";
import { fixtureTrainerHands, type FixtureHand } from "./trainer.js";

/** Hands one review block serves (the api's REVIEW_BLOCK_INSTANCES, O-272). */
export const FIXTURE_BLOCK_SIZE = 3;
export const FIXTURE_AUTOMATED_SESSION_ID = "00000000-0000-4000-8000-000000000020";
export const FIXTURE_HOLDOUT_SESSION_ID = "00000000-0000-4000-8000-000000000021";
const STARTED_AT = "2026-10-27T12:00:00Z";
const ENDED_AT = "2026-10-27T12:20:00Z";

function classAt(rowIndex: number, columnIndex: number): { key: string; family: string } {
  const row = FIXTURE_HEATMAP_ROWS[rowIndex];
  const column = FIXTURE_HEATMAP_COLUMNS[columnIndex];
  if (row === undefined || column === undefined) throw new RangeError("no such fixture heat map cell");
  return { key: fixtureClassKey(row, column), family: row.family };
}

/** rfi BB-BTN at online 100 bb: a practiced class in the opens track. */
const RATED_CLASS = classAt(2, 1);
/** facing-open BB-CO at online 150 bb: a class the learner has never seen. */
const NEW_CLASS = classAt(4, 2);

export const fixtureRatedBlock: AutomatedBlock = {
  spot_class_key: RATED_CLASS.key,
  track_key: "opens",
  family: RATED_CLASS.family,
  served: 0,
  size: FIXTURE_BLOCK_SIZE,
  worked_example: false,
};

export const fixtureWorkedBlock: AutomatedBlock = {
  spot_class_key: NEW_CLASS.key,
  track_key: "facing-open-ip",
  family: NEW_CLASS.family,
  served: 0,
  size: FIXTURE_BLOCK_SIZE,
  worked_example: true,
};

/** The two blocks in the order a fresh session serves them in the mocks: rated, then a worked example. */
export const fixtureAutomatedBlocks: readonly AutomatedBlock[] = [fixtureRatedBlock, fixtureWorkedBlock];

export function fixtureAutomatedSession(block: AutomatedBlock = fixtureRatedBlock): PracticeSession {
  return {
    session_id: FIXTURE_AUTOMATED_SESSION_ID,
    mode: "automated",
    drill_id: null,
    state: "await_hero",
    state_version: 1,
    started_at: STARTED_AT,
    rated_eligible: true,
    automated: block,
    holdout: null,
  };
}

export const fixtureHoldoutProgress: HoldoutProgress = { round_month: "2026-10-01", answered: 12, total: 30 };

export const fixtureHoldoutSession: PracticeSession = {
  session_id: FIXTURE_HOLDOUT_SESSION_ID,
  mode: "holdout",
  drill_id: null,
  state: "await_hero",
  state_version: 1,
  started_at: STARTED_AT,
  rated_eligible: false,
  automated: null,
  holdout: fixtureHoldoutProgress,
};

/** The trainer fixture hand at `index` (cycled) served in a block, with its class fields. */
export function fixtureBlockPrompt(block: AutomatedBlock, index: number, sessionId: string, stateVersion: number): TrainerPrompt {
  const hand = fixtureTrainerHands[index % fixtureTrainerHands.length] as FixtureHand;
  return {
    ...hand.prompt,
    session_id: sessionId,
    state_version: stateVersion,
    hand_no: index,
    spot_class_key: block.spot_class_key,
    track_key: block.track_key,
    worked_example: block.worked_example,
  };
}

/** A holdout item: the trainer fixture hand, no class shown as a block, never a worked example. */
export function fixtureHoldoutPrompt(index: number, stateVersion: number): TrainerPrompt {
  const hand = fixtureTrainerHands[index % fixtureTrainerHands.length] as FixtureHand;
  return { ...hand.prompt, session_id: FIXTURE_HOLDOUT_SESSION_ID, state_version: stateVersion, hand_no: index, worked_example: false };
}

/** A session with rated decisions: two tracks moved (one rated for the first time), a tier held, an unlock. */
export const fixtureTrainingRecap: SessionRecap = {
  session_id: FIXTURE_AUTOMATED_SESSION_ID,
  ended_at: ENDED_AT,
  decisions: 5,
  rated_decisions: 3,
  mean_score: 0.814,
  ev_loss_bb_total: 0.42,
  rating_changes: [
    { track_key: "opens", before: { mu: 1584.2, rd: 96.4 }, after: { mu: 1601.7, rd: 91.8 } },
    { track_key: "facing-open-ip", before: null, after: { mu: 1532.3, rd: 289.6 } },
  ],
  tier: { overall: 1418, tier: "II", band_tier: "III", blocked_by: ["facing-open-ip"] },
  unlocks: ["badge-tier-II"],
};

/** A session whose decisions were all worked examples (or a holdout retest): nothing rated. */
export const fixtureUnratedRecap: SessionRecap = {
  session_id: FIXTURE_AUTOMATED_SESSION_ID,
  ended_at: ENDED_AT,
  decisions: 3,
  rated_decisions: 0,
  mean_score: null,
  ev_loss_bb_total: 0.31,
  rating_changes: [],
  tier: null,
  unlocks: [],
};
