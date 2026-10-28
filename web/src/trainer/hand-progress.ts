/**
 * Where a prompt sits in its hand, and how the last hand ended (S26, R3.13, O-313, O-335, PR #30
 * review MEDIUM 5 and 6). Pure: no input/output, no clock and no randomness.
 *
 * Mechanism: every prompt carries hand_no, equal on two prompts of one hand (street and full-hand
 * modes), hand_decision_no, the hero's decision index within that hand as the api counts it
 * (O-335), and previous_hand once a hand has ended. advanceHand takes the progress of the prompt
 * shown before (null at the first prompt this page shows) and the new prompt:
 * - the same prompt read again (same hand_no and state_version, as after a stale recovery) keeps
 *   the progress object;
 * - the same hand_no is the hand on screen, now at the prompt's decision;
 * - any other hand_no starts a new hand, numbered by the hands this page has seen (the ordinal,
 *   from 1, restarting at 1 after a reload). The api's hand_no is never shown: it skips numbers
 *   when deals are skipped. The new hand carries the prompt's previous_hand with the hero and
 *   ordinal of the hand shown before when that is the hand that ended (the closing actions are
 *   counted from that hero's last action), or neither when that hand was not seen.
 * The decision number is always the prompt's hand_decision_no and the hero its hero_position, so a
 * reload mid-hand shows the right decision and hero (MEDIUM 6).
 *
 * summarizeHand words the ended hand, one wording per previous_hand.end (MEDIUM 5): the api records
 * end where the hand ended, so the screen never guesses it. street_closed reads "Ended at the
 * flop" when the hand reached a board (full-hand mode reveals the flop in v1) and "Ended when the
 * street closed" when it did not.
 */
import type { Position, TrainerPrompt } from "../contracts.js";
import type { PreviousHand } from "./session-types.js";

/** The hand that ended just before the one on screen, with the hero and ordinal it was shown with. */
export interface EndedHand {
  readonly hand: PreviousHand;
  /** The hero of the ended hand, or null when its prompts were not shown on this page. */
  readonly heroPosition: Position | null;
  /** The ended hand's ordinal on this page, or null when it was not shown. */
  readonly ordinal: number | null;
}

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
  /** Set at the first prompt of a hand that follows an ended hand; null otherwise. */
  readonly endedHand: EndedHand | null;
}

export interface HandSummaryView {
  readonly title: string;
  readonly endText: string;
  /** "BTN Raise to 22bb", "BB Call": the hero's last action and what followed it. */
  readonly closing: readonly string[];
  /** The board the hand reached; empty when it ended preflop. */
  readonly flop: readonly string[];
}

const FIRST_ORDINAL = 1;
const UNSEEN_HAND_TITLE = "Previous hand";

function endedHandOf(previous: HandProgress | null, prompt: TrainerPrompt): EndedHand | null {
  const hand = prompt.previous_hand;
  if (hand === null || hand.hand_no >= prompt.hand_no) return null;
  const seen = previous !== null && previous.handNo === hand.hand_no;
  return { hand, heroPosition: seen ? previous.heroPosition : null, ordinal: seen ? previous.ordinal : null };
}

export function advanceHand(previous: HandProgress | null, prompt: TrainerPrompt): HandProgress {
  const sameHand = previous !== null && previous.handNo === prompt.hand_no;
  if (sameHand && previous.stateVersion === prompt.state_version) return previous;
  const shown = { decision: prompt.hand_decision_no, stateVersion: prompt.state_version, heroPosition: prompt.hero_position };
  if (sameHand) return { ...previous, ...shown, endedHand: null };
  return {
    handNo: prompt.hand_no,
    ordinal: previous === null ? FIRST_ORDINAL : previous.ordinal + 1,
    ...shown,
    endedHand: endedHandOf(previous, prompt),
  };
}

/** "Hand 2", or "Previous hand" for a hand this page did not show. */
export function handTitle(ordinal: number | null): string {
  return ordinal === null ? UNSEEN_HAND_TITLE : `Hand ${ordinal}`;
}

/** "Hand 3, decision 2". */
export function handCounterText(progress: HandProgress): string {
  return `${handTitle(progress.ordinal)}, decision ${progress.decision}`;
}

/** One wording per previous_hand.end; street_closed names the flop when the hand reached one. */
function endText(hand: PreviousHand): string {
  switch (hand.end) {
    case "fold":
      return "Ended with a fold";
    case "off_range":
      return "Ended when the hand left the solution's range";
    case "street_closed":
      return hand.board.length > 0 ? "Ended at the flop" : "Ended when the street closed";
    case "stop_rule":
      return "Spot over";
  }
}

function closingEntries(hand: PreviousHand, heroPosition: Position | null): PreviousHand["history"] {
  const heroLast = heroPosition === null ? -1 : hand.history.findLastIndex((entry) => entry.position === heroPosition);
  const from = heroLast >= 0 ? heroLast : Math.max(0, hand.history.length - 1);
  return hand.history.slice(from);
}

export function summarizeHand(ended: EndedHand): HandSummaryView {
  const { hand, heroPosition, ordinal } = ended;
  return {
    title: handTitle(ordinal),
    endText: endText(hand),
    closing: closingEntries(hand, heroPosition).map((entry) => `${entry.position} ${entry.label}`),
    flop: [...hand.board],
  };
}
