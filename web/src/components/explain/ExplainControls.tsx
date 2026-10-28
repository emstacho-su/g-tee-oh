/**
 * More info and Ask in the feedback panel (S27 lane D, R3.19, R3.20, 05 section 10, ADR 0016,
 * O-305 to O-309): the More info dialog with the template sections, and the Ask button whose state
 * comes from GET /explain/status (disabled while the flag is off or above the monthly cap) with its
 * dialog. Scaffold; lane D builds it.
 */
import type { DecisionFeedback } from "../../contracts.js";

export interface ExplainControlsProps {
  feedback: DecisionFeedback;
}

export function ExplainControls({ feedback }: ExplainControlsProps) {
  return <div data-testid="explain-controls" data-attempt={feedback.attempt_id} />;
}
