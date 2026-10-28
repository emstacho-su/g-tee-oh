/**
 * Where a prompt sits in its hand (S26, R3.13, O-313, O-335, PR #30 review MEDIUM 6). Pure: no
 * input/output, no clock and no randomness.
 *
 * Mechanism: every prompt carries hand_no, equal on two prompts of one hand (street and full-hand
 * modes), and hand_decision_no, the hero's decision index within that hand as the api counts it
 * (O-335). advanceHand takes the progress of the prompt shown before (null at the first prompt this
 * page shows) and the new prompt:
 * - the same prompt read again (same hand_no and state_version, as after a stale recovery) keeps
 *   the progress object;
 * - the same hand_no is the hand on screen, now at the prompt's decision;
 * - any other hand_no starts a new hand, numbered by the hands this page has seen (the ordinal,
 *   from 1, restarting at 1 after a reload). The api's hand_no is never shown: it skips numbers
 *   when deals are skipped.
 * The decision number is always the prompt's hand_decision_no and the hero its hero_position, so a
 * reload mid-hand shows the right decision and hero (MEDIUM 6).
 *
 * S40 (O-352): the summary of the hand that ended is no longer shown, so the prompt's previous_hand
 * is not read here; the api logs each finished hand (hand_record) instead.
 */
import type { Position, TrainerPrompt } from "../contracts.js";

export interface HandProgress {
  /** The api's hand number (from 0); compared, never shown. */
  readonly handNo: number;
  /** The hand's place among the hands this page has seen, from 1. */
  readonly ordinal: number;
  /** The hero's decision within the hand, from 1 (the prompt's hand_decision_no). */
  readonly decision: number;
  /** The state version of the prompt this progress was made for. */
  readonly stateVersion: number;
  readonly heroPosition: Position;
}

const FIRST_ORDINAL = 1;

export function advanceHand(previous: HandProgress | null, prompt: TrainerPrompt): HandProgress {
  const sameHand = previous !== null && previous.handNo === prompt.hand_no;
  if (sameHand && previous.stateVersion === prompt.state_version) return previous;
  const shown = { decision: prompt.hand_decision_no, stateVersion: prompt.state_version, heroPosition: prompt.hero_position };
  if (sameHand) return { ...previous, ...shown };
  return { handNo: prompt.hand_no, ordinal: previous === null ? FIRST_ORDINAL : previous.ordinal + 1, ...shown };
}

/** "Hand 3, decision 2". */
export function handCounterText(progress: HandProgress): string {
  return `Hand ${progress.ordinal}, decision ${progress.decision}`;
}
