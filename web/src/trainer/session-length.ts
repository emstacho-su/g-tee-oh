/**
 * The planned session length (S46, R3.31, design rule 10, O-472). Pure: no input/output, no
 * clock and no randomness.
 *
 * Mechanism: the choice is Off or 10, 20 or 50 hands, kept per browser in the session defaults
 * and carried into the session context at Start, so a change on a start panel never moves a
 * running session. The hand count is the context's hand progress (hand-progress.ts), advanced on
 * every prompt in every mode. In spot mode (and automated and holdout sessions, which stop after
 * every action) the reveal of the last planned hand is the session's last: atSessionLimit names
 * it, the screen offers Finish session and the machine ends on Next or on the automatic continue
 * instead of dealing again. In street and full-hand modes a hand ends only when the next prompt
 * arrives, so the prompt that opens a hand past the length ends the session at once
 * (pastSessionLimit); that dealt hand goes unplayed, which the api-side length of O-472 removes.
 */
import type { SessionContext, SpotState } from "./spot-machine.js";

export const SESSION_LENGTHS = [10, 20, 50] as const;

/** The stop rule of one decision per hand (pause-rule.ts SPOT_MODE_SETTINGS). */
const SPOT_STOP_RULE = "after_action";

/** A planned length in hands, or null for no limit. */
export type SessionLength = (typeof SESSION_LENGTHS)[number] | null;

export const SESSION_LENGTH_TEXT = {
  legend: "Session length",
  off: "Off",
  hint: "The session ends by itself after this many hands and shows the recap.",
  hands: (count: number) => `${count} hands`,
} as const;

export function isSessionLength(value: unknown): value is SessionLength {
  return value === null || (typeof value === "number" && (SESSION_LENGTHS as readonly number[]).includes(value));
}

export function sessionLengthLabel(length: SessionLength): string {
  return length === null ? SESSION_LENGTH_TEXT.off : SESSION_LENGTH_TEXT.hands(length);
}

/** The context's length, null when the session has none. */
export function sessionLengthOf(context: SessionContext): SessionLength {
  return context.length ?? null;
}

/** One decision per hand: spot mode (stop rule after_action) and the automated and holdout sessions, which carry no run settings. */
function oneDecisionPerHand(context: SessionContext): boolean {
  return (context.trainer?.stop_rule ?? SPOT_STOP_RULE) === SPOT_STOP_RULE;
}

/**
 * The reveal on screen is the last planned hand's, in a mode with one decision per hand. In street
 * and full-hand modes a reveal is never the limit, since the hand may go on; there the prompt that
 * opens the next hand decides (pastSessionLimit, PR #45 review round 1, finding 1). The machine
 * and the Finish session label both read this one function.
 */
export function atSessionLimit(state: SpotState): boolean {
  if (state.kind !== "feedback" || !oneDecisionPerHand(state.context)) return false;
  const length = sessionLengthOf(state.context);
  const hand = state.context.hand;
  return length !== null && hand !== undefined && hand.ordinal >= length;
}

/** A prompt that opens a hand past the planned length (street and full-hand modes). */
export function pastSessionLimit(context: SessionContext, ordinal: number): boolean {
  const length = sessionLengthOf(context);
  return length !== null && ordinal > length;
}
