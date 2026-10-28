/**
 * The insight cards in the feedback panel (S27 lane C, R3.18, 05 section 9, O-304): the noise
 * flags the decision was graded with (graded for feedback, excluded from the rating) and range
 * drift for the decision's node family, hidden below 30 decisions. Scaffold; lane C builds it.
 */
import type { DecisionFeedback } from "../../contracts.js";

export interface FeedbackInsightsProps {
  feedback: DecisionFeedback;
}

export function FeedbackInsights({ feedback }: FeedbackInsightsProps) {
  return <div data-testid="feedback-insights" data-spot-class={feedback.spot_class_key} />;
}
