/**
 * The selected hand's threshold card (S25, R3.12, O-286). Insights need a hand, so nothing is read
 * until a matrix cell is selected; until then a short prompt asks for one. With a hand, the card
 * loads from studyInsightsQuery for this node and hand and renders through the S24 ThresholdCard,
 * which marks the hero's hand. A hand that left the range (404 hand-not-in-range) says so; other
 * failures show the fixed message from problem-text.ts with a retry when it can help.
 */
import { useQuery } from "@tanstack/react-query";

import type { AppApi } from "../../api/index.js";
import { ThresholdCard } from "../../components/panels/index.js";
import type { StudyNode } from "../../contracts.js";
import { insightsFailure } from "../../study/problem-text.js";
import { studyInsightsQuery } from "../../study/queries.js";
import { LoadingNote } from "../../components/ui/index.js";
import { FailureAlert } from "./StudyNotices.js";

export const PICK_A_CELL = "Pick a cell in the matrix to see that hand's threshold card.";

export interface HandInsightsProps {
  api: AppApi;
  node: Pick<StudyNode, "solution_id" | "node_key">;
  hand: string | undefined;
}

interface SelectedHandInsightsProps extends HandInsightsProps {
  hand: string;
}

function SelectedHandInsights({ api, node, hand }: SelectedHandInsightsProps) {
  const insights = useQuery(studyInsightsQuery(api, { solutionId: node.solution_id, nodeKey: node.node_key, hand }));
  if (insights.isPending) return <LoadingNote text={`Loading the threshold card for ${hand}.`} />;
  if (insights.isError) {
    return <FailureAlert failure={insightsFailure(insights.error, hand)} onRetry={() => void insights.refetch()} />;
  }
  return <ThresholdCard card={insights.data.threshold_card} heroHand={hand} />;
}

export function HandInsights({ api, node, hand }: HandInsightsProps) {
  if (hand === undefined) return <p className="text-sm text-muted">{PICK_A_CELL}</p>;
  return <SelectedHandInsights api={api} node={node} hand={hand} />;
}
