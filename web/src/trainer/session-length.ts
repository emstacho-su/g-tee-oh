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
import { SPOT_MODE_SETTINGS } from "./pause-rule.js";
import type { SessionContext, SpotState } from "./spot-machine.js";

export const SESSION_LENGTHS = [10, 20, 50] as const;

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

/**
 * One decision per hand: spot mode (stop rule after_action, also when the run settings name none)
 * and the automated and holdout sessions, which carry no run settings. The rule is read from
 * pause-rule.ts SPOT_MODE_SETTINGS, never retyped (PR #45 review round 4, finding h).
 */
export function oneDecisionPerHand(context: Pick<SessionContext, "trainer">): boolean {
  return (context.trainer?.stop_rule ?? SPOT_MODE_SETTINGS.stop_rule) === SPOT_MODE_SETTINGS.stop_rule;
}

/** The hands of the session with at least one graded decision, and the last of them (its hand_no). */
export interface PlayedHands {
  readonly count: number;
  readonly lastHandNo: number | null;
}

const NO_PLAYED_HANDS: PlayedHands = { count: 0, lastHandNo: null };

/** The context's played hands; none before the first graded decision. */
export function playedHandsOf(context: SessionContext): PlayedHands {
  return context.played ?? NO_PLAYED_HANDS;
}

/**
 * The context after a graded decision: its hand counts once, however many decisions it holds. A
 * prompt seen but never graded (a 409 stale reload into a new hand) never counts, so the planned
 * length is a number of played hands (PR #45 review round 3, finding 5).
 */
export function withGradedHand(context: SessionContext): SessionContext {
  const hand = context.hand;
  const played = playedHandsOf(context);
  if (hand === undefined || played.lastHandNo === hand.handNo) return context;
  return { ...context, played: { count: played.count + 1, lastHandNo: hand.handNo } };
}

/** The number the counter gives the hand on screen: the played hands, plus this one when not yet graded. */
export function playedOrdinal(context: SessionContext): number | null {
  const hand = context.hand;
  if (hand === undefined) return null;
  const played = playedHandsOf(context);
  return played.lastHandNo === hand.handNo ? played.count : played.count + 1;
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
  return length !== null && playedHandsOf(state.context).count >= length;
}

/**
 * A prompt that opens a new hand once the planned hands are played (street and full-hand modes; a
 * spot-mode session already ended at its last reveal). previous is the context before the prompt.
 */
export function pastSessionLimit(previous: SessionContext, prompt: { readonly hand_no: number }): boolean {
  const length = sessionLengthOf(previous);
  const opensNewHand = previous.hand === undefined || previous.hand.handNo !== prompt.hand_no;
  return length !== null && opensNewHand && playedHandsOf(previous).count >= length;
}
