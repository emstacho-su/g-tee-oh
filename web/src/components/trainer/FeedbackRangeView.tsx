/**
 * The range view in the feedback panel (S25, R3.13, O-281): the decided node's matrix in
 * frequency mode with the hero's class selected, read through studyNodeQuery after the decision.
 * SCAFFOLD: Lane C implements it; the props are final.
 */
import type { DecisionFeedback } from "../../contracts.js";

export interface FeedbackRangeViewProps {
  feedback: DecisionFeedback;
}

export function FeedbackRangeView({ feedback }: FeedbackRangeViewProps) {
  return <div data-testid="feedback-range-view-stub" data-attempt={feedback.attempt_id} />;
}
