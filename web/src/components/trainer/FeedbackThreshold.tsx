/**
 * The threshold card in the feedback panel (S25, R3.13, O-281, 05 section 5 step 4).
 *
 * Mechanism: only after the decision, this reads GET /study/insights for the decided node
 * (feedback.solution_id and node_key, O-281) and the hero's hand through studyInsightsQuery, the
 * shared study query factory, and renders the existing ThresholdCard with the hero's class
 * marked. The hand goes to the api as the feedback carries it (a class or two cards, both
 * accepted); the class from heroHandClass is only what the card highlights. A 404 whose problem
 * slug is hand-not-in-range means the hand left the range before this node, so the panel says
 * the hand is outside the node's range rather than showing an error; every other failure is an
 * explicit alert with a retry (FeedbackQueryState).
 */
import { useQuery } from "@tanstack/react-query";

import { isHandNotInRange } from "../../api/index.js";
import { useAppApi } from "../../auth/index.js";
import type { DecisionFeedback, NodeAction } from "../../contracts.js";
import { heroHandClass } from "../../poker/hand-class.js";
import { studyInsightsQuery } from "../../study/queries.js";
import { ThresholdCard } from "../panels/ThresholdCard.js";
import { LoadingNote } from "../ui/index.js";
import { QueryFailure } from "./FeedbackQueryState.js";

export interface FeedbackThresholdProps {
  feedback: DecisionFeedback;
  /**
   * The decided node's actions (the prompt's buttons), so the card names each threshold action and
   * shows its swatch instead of a token (S38, O-198); without them it names actions from the token.
   */
  actions?: readonly NodeAction[];
}

export function FeedbackThreshold({ feedback, actions }: FeedbackThresholdProps) {
  const api = useAppApi();
  const query = useQuery(
    studyInsightsQuery(api, { solutionId: feedback.solution_id, nodeKey: feedback.node_key, hand: feedback.hand }),
  );
  const heroHand = heroHandClass(feedback.hand) ?? feedback.hand;
  if (query.isPending) return <LoadingNote text="Loading the threshold card" />;
  if (query.isError) {
    if (isHandNotInRange(query.error)) {
      return (
        <p data-testid="feedback-threshold-out-of-range" className="text-sm text-muted">
          {`Your hand, ${heroHand}, is outside this node's range, so there is no threshold card for it.`}
        </p>
      );
    }
    return (
      <QueryFailure
        subject="The threshold card"
        error={query.error}
        retryLabel="Retry the threshold card"
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <ThresholdCard card={query.data.threshold_card} heroHand={heroHand} {...(actions === undefined ? {} : { actions })} />;
}
