/**
 * The hand and decision counter of street and full-hand modes (S26, R3.13, O-313, O-335): "Hand 3,
 * decision 2", from the session's hand progress (trainer/hand-progress.ts): the hand's ordinal
 * among the hands this page has seen and the prompt's hand_decision_no. A polite live region,
 * so a screen reader hears when a new hand starts or the hand goes on.
 */
import { handCounterText, type HandProgress } from "../../trainer/hand-progress.js";

export interface HandCounterProps {
  progress: HandProgress;
}

export function HandCounter({ progress }: HandCounterProps) {
  return (
    <p data-testid="hand-counter" aria-live="polite" className="text-sm font-semibold tabular-nums text-muted">
      {handCounterText(progress)}
    </p>
  );
}
