/**
 * Where a prompt sits in its hand, and how the last hand ended (S26, R3.13, O-313). Pure: no
 * input/output, no clock and no randomness.
 *
 * Mechanism: every prompt carries hand_no, equal on two prompts of one hand (street and full-hand
 * modes), and previous_hand once a hand has ended. advanceHand takes the progress of the prompt
 * shown before (null at the session's first prompt) and the new prompt:
 * - the same prompt read again (same hand_no and state_version, as after a stale recovery) keeps
 *   the progress object, so the decision number does not grow;
 * - the same hand_no is the next decision of the hand on screen;
 * - any other hand_no starts a new hand at decision 1, and carries the prompt's previous_hand
 *   with the hero of the hand shown before (the closing actions are counted from that hero's last
 *   action), or no hero when that hand was not seen.
 * summarizeHand words the ended hand for the drill's stop rule: its closing actions, the flop when
 * the board has cards (full-hand mode reveals it in v1) and why it ended. Hand numbers are shown
 * from 1; the api counts them from 0.
 */
import type { Position, TrainerPrompt } from "../contracts.js";
import type { PreviousHand, StopRule } from "./session-types.js";

/** The hand that ended just before the one on screen, with the hero it was played by. */
export interface EndedHand {
  readonly hand: PreviousHand;
  /** The hero of the ended hand, or null when its prompts were not shown in this session. */
  readonly heroPosition: Position | null;
}

export interface HandProgress {
  /** The api's hand number (from 0). */
  readonly handNo: number;
  /** The decision within the hand, from 1. */
  readonly decision: number;
  /** The state version of the prompt this progress was made for. */
  readonly stateVersion: number;
  readonly heroPosition: Position;
  /** Set at the first decision of a hand that follows an ended hand; null otherwise. */
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

const FIRST_DECISION = 1;
const SHOWN_NUMBER_OFFSET = 1;

function endedHandOf(previous: HandProgress | null, prompt: TrainerPrompt): EndedHand | null {
  const hand = prompt.previous_hand;
  if (hand === null || hand.hand_no >= prompt.hand_no) return null;
  const heroPosition = previous !== null && previous.handNo === hand.hand_no ? previous.heroPosition : null;
  return { hand, heroPosition };
}

export function advanceHand(previous: HandProgress | null, prompt: TrainerPrompt): HandProgress {
  const sameHand = previous !== null && previous.handNo === prompt.hand_no;
  if (sameHand && previous.stateVersion === prompt.state_version) return previous;
  if (sameHand) {
    return { ...previous, decision: previous.decision + 1, stateVersion: prompt.state_version, heroPosition: prompt.hero_position, endedHand: null };
  }
  return {
    handNo: prompt.hand_no,
    decision: FIRST_DECISION,
    stateVersion: prompt.state_version,
    heroPosition: prompt.hero_position,
    endedHand: endedHandOf(previous, prompt),
  };
}

export function handTitle(handNo: number): string {
  return `Hand ${handNo + SHOWN_NUMBER_OFFSET}`;
}

/** "Hand 3, decision 2". */
export function handCounterText(progress: HandProgress): string {
  return `${handTitle(progress.handNo)}, decision ${progress.decision}`;
}

const STOP_RULE_END_TEXT: Readonly<Record<StopRule, string>> = {
  after_action: "Ended after your decision",
  end_of_street: "Ended at the end of the street",
  end_of_hand: "Ended at the end of the hand",
};

function endText(hand: PreviousHand, stopRule: StopRule): string {
  switch (hand.end) {
    case "fold":
      return "Ended with a fold";
    case "off_range":
      return "Ended when the hand left the solution's range";
    case "street_closed":
      return stopRule === "end_of_hand" && hand.board.length > 0 ? "Ended at the flop" : "Ended when the street closed";
    case "stop_rule":
      return STOP_RULE_END_TEXT[stopRule];
  }
}

function closingEntries(hand: PreviousHand, heroPosition: Position | null): PreviousHand["history"] {
  const heroLast = heroPosition === null ? -1 : hand.history.findLastIndex((entry) => entry.position === heroPosition);
  const from = heroLast >= 0 ? heroLast : Math.max(0, hand.history.length - 1);
  return hand.history.slice(from);
}

export function summarizeHand(ended: EndedHand, stopRule: StopRule): HandSummaryView {
  const { hand, heroPosition } = ended;
  return {
    title: handTitle(hand.hand_no),
    endText: endText(hand, stopRule),
    closing: closingEntries(hand, heroPosition).map((entry) => `${entry.position} ${entry.label}`),
    flop: [...hand.board],
  };
}
