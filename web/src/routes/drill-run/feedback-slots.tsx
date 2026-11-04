/**
 * The feedback panel's section bodies for one decision (S38, S46, R3.13, R3.32, O-281, O-388):
 * the range view and the threshold card of the decided node, the roll scale with its
 * followed-the-roll mark when the decision had a roll (O-344, O-371), the insights and More info
 * as the Explanation section. The live reveal (DecisionArea) and every row of the session history
 * (SessionHistory) build their panels from this one helper, so a reopened decision shows the same
 * sections it showed at the reveal. Each body reads the api only when its section first opens.
 */
import { FeedbackRangeView, FeedbackRoller, FeedbackThreshold } from "../../components/trainer/index.js";
import { MoreInfoSection } from "../../components/explain/MoreInfoSection.js";
import { FeedbackInsights } from "../../components/insights/FeedbackInsights.js";
import type { DecisionFeedback, Grouping, NodeAction, Street } from "../../contracts.js";
import type { DecisionEntry } from "../../trainer/session-log.js";
import type { HistorySlots } from "./SessionHistory.js";

export interface FeedbackSlotsInput {
  readonly feedback: DecisionFeedback;
  readonly actions: readonly NodeAction[];
  /** NodeAction.index of the chosen action (O-198). */
  readonly chosenIndex: number;
  /** The grouping the session was started and graded with (PR #33 review round 1). */
  readonly grouping: Grouping;
  readonly street: Street;
  /** The session runs in Mixed-frequency mode, so the Roll section is offered. */
  readonly rng: boolean;
  readonly onExplain: () => void;
}

export function feedbackSlots(input: FeedbackSlotsInput): HistorySlots {
  const { feedback, actions, chosenIndex, grouping, street, rng, onExplain } = input;
  return {
    rangeView: <FeedbackRangeView feedback={feedback} />,
    thresholdCard: <FeedbackThreshold feedback={feedback} actions={actions} />,
    ...(rng
      ? { roller: <FeedbackRoller feedback={feedback} actions={actions} chosenIndex={chosenIndex} grouping={grouping} street={street} onExplain={onExplain} /> }
      : {}),
    insights: <FeedbackInsights feedback={feedback} />,
    explanation: <MoreInfoSection key={`more-info-${feedback.attempt_id}`} attemptId={feedback.attempt_id} />,
  };
}

/** The section bodies of a history row: the entry's own decision, roll and session grouping. */
export function historySlotsFor(onExplain: () => void): (entry: DecisionEntry) => HistorySlots {
  return (entry) =>
    feedbackSlots({
      feedback: entry.feedback,
      actions: entry.prompt.buttons,
      chosenIndex: entry.actionIndex,
      grouping: entry.session.grouping,
      street: entry.prompt.street,
      // A decision carries a roll only in Mixed-frequency mode.
      rng: entry.feedback.rng_roll !== null,
      onExplain,
    });
}
