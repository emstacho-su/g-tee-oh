/**
 * The node's actions tables (S25, R3.12, O-280, O-198, ADR 0004). The first table is the range's
 * share per action from StudyNode.range_by_action, mapped to positions by NodeAction.index
 * (range-shares.ts); a mismatch renders an alert instead of a table. With a hand selected, a
 * second table shows that hand's own row as the api sent it: its strategy and its EV in big blinds
 * per action. Nothing is aggregated or recomputed here; a hand with no row says it is not in the
 * range at this node.
 */
import { ActionFrequencyTable } from "../../components/panels/index.js";
import type { StudyNode } from "../../contracts.js";
import { sharesByPosition } from "../../study/range-shares.js";

export const RANGE_TABLE_CAPTION = "Range by action at this node";

export interface NodeActionsPanelProps {
  node: Pick<StudyNode, "actions" | "range_by_action" | "hands">;
  hand: string | undefined;
}

interface HandRowProps {
  node: NodeActionsPanelProps["node"];
  hand: string;
}

function HandRow({ node, hand }: HandRowProps) {
  const row = node.hands.find((candidate) => candidate.hand === hand);
  if (row === undefined) return <p className="text-sm text-muted">{`${hand} is not in the range at this node.`}</p>;
  return (
    <ActionFrequencyTable
      actions={node.actions}
      frequencies={row.strategy}
      evBb={row.ev_bb}
      caption={`${hand} at this node: strategy and EV`}
    />
  );
}

export function NodeActionsPanel({ node, hand }: NodeActionsPanelProps) {
  const shares = sharesByPosition(node.actions, node.range_by_action);
  return (
    <div className="flex flex-col gap-4">
      {shares.kind === "ok" ? (
        <ActionFrequencyTable actions={node.actions} frequencies={shares.shares} caption={RANGE_TABLE_CAPTION} />
      ) : (
        <p role="alert" className="text-danger">{`Cannot show the range by action: ${shares.problem}.`}</p>
      )}
      {hand === undefined ? null : <HandRow node={node} hand={hand} />}
    </div>
  );
}
