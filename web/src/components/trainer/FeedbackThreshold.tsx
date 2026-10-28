/**
 * The threshold card in the feedback panel (S25, R3.13, O-281), read through studyInsightsQuery
 * for the decided node and the hero's hand after the decision.
 * SCAFFOLD: Lane C implements it; the props are final.
 */
import type { DecisionFeedback } from "../../contracts.js";

export interface FeedbackThresholdProps {
  feedback: DecisionFeedback;
}

export function FeedbackThreshold({ feedback }: FeedbackThresholdProps) {
  return <div data-testid="feedback-threshold-stub" data-attempt={feedback.attempt_id} />;
}
