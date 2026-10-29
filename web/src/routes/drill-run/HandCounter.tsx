/**
 * The hand counter (S26, S46, R3.13, R3.31, O-313, O-335): "Hand 3, decision 2" in street and
 * full-hand modes, "Hand 7 of 20" when a session length is planned, from the session's hand
 * progress (trainer/hand-progress.ts): the hand's ordinal among the hands this page has seen and
 * the prompt's hand_decision_no. A polite live region, so a screen reader hears when a new hand
 * starts or the hand goes on.
 */
import { handCounterText, type HandProgress } from "../../trainer/hand-progress.js";
import type { SessionLength } from "../../trainer/session-length.js";

export interface HandCounterProps {
  progress: HandProgress;
  /** The planned session length, or null (S46, R3.31). */
  length?: SessionLength;
  /** Whether the decision within the hand is named; true by default (street and full-hand modes). */
  decision?: boolean;
}

export function HandCounter({ progress, length = null, decision = true }: HandCounterProps) {
  return (
    <p data-testid="hand-counter" aria-live="polite" className="text-sm font-semibold tabular-nums text-muted">
      {handCounterText(progress, { length, decision })}
    </p>
  );
}
