/**
 * The insights beside the study matrix (S25, S45, R3.12, O-286, O-461).
 *
 * Mechanism: the insights read requires a hand, but the range and nut advantage do not depend on
 * it. So the advantage card reads with a stand-in hand (the first class the node holds) from the
 * moment the node shows, and the hand-dependent tiles (the threshold card, the blockers and the
 * role chip in the hand's heading) read with the selected hand once one is chosen. When the
 * selected hand is the stand-in the two reads share one query key, so nothing is fetched twice; a
 * hover never changes either read (R3.25). The threshold card gets the node's actions, so its rows
 * carry the exact labels and swatches (O-198). A selected hand that left the range (404
 * hand-not-in-range) says so while the advantage card stays; other failures show the fixed message
 * from problem-text.ts with a retry when it can help. A hand-less api variant is O-461.
 */
import { useQuery } from "@tanstack/react-query";

import type { AppApi } from "../../api/index.js";
import { BlockersCard, HandRoleChip, RangeAdvantageCard, ThresholdCard } from "../../components/panels/index.js";
import type { StudyNode } from "../../contracts.js";
import { insightsFailure } from "../../study/problem-text.js";
import { studyInsightsQuery } from "../../study/queries.js";
import { LoadingNote } from "../../components/ui/index.js";
import { FailureAlert } from "./StudyNotices.js";

export const PICK_A_CELL = "Pick a cell in the matrix to see that hand's threshold card, blockers and role.";

type InsightsNode = Pick<StudyNode, "solution_id" | "node_key" | "pair" | "to_act" | "actions" | "hands">;

export interface HandInsightsProps {
  api: AppApi;
  node: InsightsNode;
  hand: string | undefined;
}

/** The hand the insights read uses before one is selected: the first class the node holds (O-461). */
export function standInHand(node: Pick<StudyNode, "hands">): string | undefined {
  return node.hands[0]?.hand;
}

/** The pair's two seats, out of position first; the contract's pair pattern always has both. */
function pairSeats(pair: string): { oop: string; ip: string } {
  const [oop = pair, ip = pair] = pair.split("-");
  return { oop, ip };
}

function insightsParams(node: InsightsNode, hand: string) {
  return { solutionId: node.solution_id, nodeKey: node.node_key, hand };
}

function AdvantageArea({ api, node, hand }: { api: AppApi; node: InsightsNode; hand: string }) {
  const insights = useQuery(studyInsightsQuery(api, insightsParams(node, hand)));
  if (insights.isPending) return <LoadingNote text="Loading the range advantage." />;
  // A failure here is the stand-in's; the selected hand's own read reports its own failure.
  if (insights.isError) return <FailureAlert failure={insightsFailure(insights.error, hand)} onRetry={() => void insights.refetch()} />;
  return (
    <RangeAdvantageCard
      rangeAdvantage={insights.data.range_advantage}
      nutAdvantage={insights.data.nut_advantage}
      seats={pairSeats(node.pair)}
      toAct={node.to_act}
    />
  );
}

function SelectedHandInsights({ api, node, hand }: { api: AppApi; node: InsightsNode; hand: string }) {
  const insights = useQuery(studyInsightsQuery(api, insightsParams(node, hand)));
  if (insights.isPending) return <LoadingNote text={`Loading the threshold card for ${hand}.`} />;
  if (insights.isError) {
    return <FailureAlert failure={insightsFailure(insights.error, hand)} onRetry={() => void insights.refetch()} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {hand}
        <HandRoleChip role={insights.data.hand_role} />
      </h3>
      <ThresholdCard card={insights.data.threshold_card} heroHand={hand} actions={node.actions} />
      <BlockersCard blockers={insights.data.blockers} role={insights.data.hand_role} />
    </div>
  );
}

export function HandInsights({ api, node, hand }: HandInsightsProps) {
  const standIn = standInHand(node);
  return (
    <div className="flex flex-col gap-4">
      {standIn === undefined ? null : <AdvantageArea api={api} node={node} hand={standIn} />}
      {hand === undefined ? <p className="text-sm text-muted">{PICK_A_CELL}</p> : <SelectedHandInsights api={api} node={node} hand={hand} />}
    </div>
  );
}
