/**
 * The insight cards in the feedback panel (S27 lane C, R3.18, 05 section 9, O-304): the noise
 * flags the decision was graded with (graded for feedback, excluded from the rating), shown only
 * when there are any, and range drift for the decision's node family (its spot_class_key), hidden
 * by the api below 30 decisions. Both are insights: neither changes the grade above them.
 */
import type { DecisionFeedback } from "../../contracts.js";
import { DriftCard } from "./DriftCard.js";
import { NoiseFlagsCard } from "./NoiseFlagsCard.js";

export interface FeedbackInsightsProps {
  feedback: DecisionFeedback;
}

export function FeedbackInsights({ feedback }: FeedbackInsightsProps) {
  return (
    <div data-testid="feedback-insights" data-spot-class={feedback.spot_class_key} className="flex flex-col gap-3">
      <NoiseFlagsCard flags={feedback.noise_flags} />
      <DriftCard spotClassKey={feedback.spot_class_key} attemptId={feedback.attempt_id} />
    </div>
  );
}
