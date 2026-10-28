/**
 * The RNG roller after the reveal (S25, R3.10, O-282, O-213): the bands from the feedback's
 * frequencies, the roll-selected action labeled Best, and an alert when that pick is not in
 * best_action_indexes. SCAFFOLD: Lane C implements it; the props are final.
 */
import type { DecisionFeedback, NodeAction } from "../../contracts.js";

export interface FeedbackRollerProps {
  feedback: DecisionFeedback;
  actions: readonly NodeAction[];
  onExplain: () => void;
}

export function FeedbackRoller({ feedback }: FeedbackRollerProps) {
  return <div data-testid="feedback-roller-stub" data-attempt={feedback.attempt_id} />;
}
