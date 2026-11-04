/**
 * The insights beside the study matrix (S25, S45, R3.12, R3.26, O-286, O-461). Two halves, one per
 * right-column tab: AdvantageInsights on Overview, HandDetails on Hands; each mounts, and reads, only
 * while its tab is open.
 *
 * Mechanism: the insights read requires a hand, but the range and nut advantage do not depend on
 * it. So the advantage card reads with a stand-in hand (the first class the node holds) from the
 * moment the node shows, and the hand-dependent tiles (the threshold card, the blockers and the
 * role chip in the hand's heading) read with the selected hand once one is chosen. When the
 * selected hand is the stand-in the two reads share one query key, so nothing is fetched twice; a
 * hover never changes either read (R3.25). The threshold card gets the node's actions, so its rows
 * carry the exact labels and swatches (O-198). A selected hand that left the range (404
 * hand-not-in-range) says so while the advantage card stays; a failed stand-in read names no hand
 * (advantageFailure, code review), and the stand-in read is keyed per node, so a revisit is a cache hit; other failures show the fixed message
 * from problem-text.ts with a retry when it can help. A hand-less api variant is O-461.
 */
import { useQuery, type Query } from "@tanstack/react-query";

import { isHandNotInRange, type AppApi } from "../../api/index.js";
import type { StudyInsights } from "../../contracts.js";
import { BlockersCard, HandRoleChip, RangeAdvantageCard, ThresholdCard } from "../../components/panels/index.js";
import type { StudyNode } from "../../contracts.js";
import { advantageFailure, insightsFailure } from "../../study/problem-text.js";
import { studyInsightsQuery } from "../../study/queries.js";
import { LoadingNote } from "../../components/ui/index.js";
import { parsePair } from "../../poker/pair.js";
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

function insightsParams(node: InsightsNode, hand: string) {
  return { solutionId: node.solution_id, nodeKey: node.node_key, hand };
}

/** Where the solution id and node key sit in studyInsightsQuery's key. */
const KEY_SOLUTION_INDEX = 2;
const KEY_NODE_INDEX = 3;

/**
 * The previous read's data, kept as a placeholder only while the node and solution are the same:
 * a new hand at the same node keeps the card (code review 3), but a node switch shows the loading
 * note, never the previous node's numbers as current (PR 52 review 1).
 */
function sameNodePlaceholder(node: Pick<InsightsNode, "solution_id" | "node_key">) {
  return (previous: StudyInsights | undefined, previousQuery: Pick<Query<StudyInsights>, "queryKey"> | undefined): StudyInsights | undefined => {
    const key = previousQuery?.queryKey;
    const sameNode = key?.[KEY_SOLUTION_INDEX] === node.solution_id && key[KEY_NODE_INDEX] === node.node_key;
    return sameNode ? previous : undefined;
  };
}

/** The advantage card's seats, out of position first; a malformed pair names itself for both. */
function advantageSeats(pair: string): { oop: string; ip: string } {
  const [oop, ip] = parsePair(pair) ?? [pair, pair];
  return { oop, ip };
}

interface AdvantageAreaProps {
  api: AppApi;
  node: InsightsNode;
  /** The selected hand, whose read the hand tiles make anyway; undefined before one is picked. */
  selected: string | undefined;
  standIn: string;
}

/**
 * The range and nut advantage, read with the selected hand when there is one (the same query the
 * hand tiles make, so one request, code review 2), else with the stand-in. When the selected hand
 * is out of the range (404 hand-not-in-range), the stand-in read takes over so the card stays.
 */
function AdvantageArea({ api, node, selected, standIn }: AdvantageAreaProps) {
  // At the same node the previous read's card stays while a new hand's read loads (code review 3, PR 52 review 1).
  const primary = useQuery({ ...studyInsightsQuery(api, insightsParams(node, selected ?? standIn)), placeholderData: sameNodePlaceholder(node) });
  const fallBack = selected !== undefined && selected !== standIn && primary.isError && isHandNotInRange(primary.error);
  const backup = useQuery({ ...studyInsightsQuery(api, insightsParams(node, standIn)), enabled: fallBack });
  const insights = fallBack ? backup : primary;
  if (insights.isPending) return <LoadingNote text="Loading the range advantage." />;
  // The message names no hand: the read may be the stand-in's, a hand the user never picked (code review).
  if (insights.isError) return <FailureAlert failure={advantageFailure(insights.error)} onRetry={() => void insights.refetch()} />;
  return (
    <RangeAdvantageCard
      rangeAdvantage={insights.data.range_advantage}
      nutAdvantage={insights.data.nut_advantage}
      seats={advantageSeats(node.pair)}
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

/** The range and nut advantage, read with the selected hand when there is one, else the stand-in; the Overview tab's half (R3.26). */
export function AdvantageInsights({ api, node, hand }: HandInsightsProps) {
  const standIn = standInHand(node);
  return standIn === undefined ? null : <AdvantageArea api={api} node={node} selected={hand} standIn={standIn} />;
}

/** The selected hand's threshold card, blockers and role, or the prompt for one; the Hands tab (R3.26). */
export function HandDetails({ api, node, hand }: HandInsightsProps) {
  return hand === undefined ? <p className="text-sm text-muted">{PICK_A_CELL}</p> : <SelectedHandInsights api={api} node={node} hand={hand} />;
}
