/**
 * The node's actions tables (S25, S45, R3.12, O-280, O-198, O-468, O-469, ADR 0004). The first
 * table is the range's share per action from StudyNode.range_by_action, mapped to positions by
 * NodeAction.index (range-shares.ts); a mismatch renders an alert instead of a table. Its rows are
 * the matrix's filters (aria-pressed toggles, the set in the address through the caller), and when
 * solver-query serves combos they print beside the percent, with the acting seat's range total
 * under the caption; nothing is multiplied here. With a hand (selected, or hovered, R3.25), a second
 * table shows that hand's own row as the api sent it: its strategy and its EV in big blinds per
 * action, the filtered actions marked. Nothing is aggregated or recomputed here; a hand with no row
 * says it is not in the range at this node.
 */
import { ActionFrequencyTable } from "../../components/panels/index.js";
import type { StudyNode } from "../../contracts.js";
import { formatCombos } from "../../poker/format.js";
import { knownFilters } from "../../study/action-filters.js";
import { combosByPosition, sharesByPosition } from "../../study/range-shares.js";

export const RANGE_TABLE_CAPTION = "Range by action at this node";
export const FILTERED_LABEL = "Filtered";

export interface NodeActionsPanelProps {
  node: Pick<StudyNode, "actions" | "range_by_action" | "range_combos" | "hands">;
  hand: string | undefined;
  /** The filtered NodeAction.index values (O-468); absent, the table is read-only. */
  filters?: readonly number[];
  onToggleFilter?: (index: number) => void;
}

interface HandRowProps {
  node: NodeActionsPanelProps["node"];
  hand: string;
  filters: readonly number[];
}

function HandRow({ node, hand, filters }: HandRowProps) {
  const row = node.hands.find((candidate) => candidate.hand === hand);
  if (row === undefined) return <p className="text-sm text-muted">{`${hand} is not in the range at this node.`}</p>;
  const known = knownFilters(filters, node.actions);
  return (
    <ActionFrequencyTable
      actions={node.actions}
      frequencies={row.strategy}
      evBb={row.ev_bb}
      highlightIndexes={known}
      highlightLabel={FILTERED_LABEL}
      caption={`${hand} at this node: strategy and EV`}
    />
  );
}

/** "1,000 of 1,326 combos reach this node" when the api serves the acting seat's range total (O-469). */
function rangeNote(node: NodeActionsPanelProps["node"]): string | undefined {
  const range = node.range_combos;
  if (range === undefined) return undefined;
  const reaching = Math.round(range.reach_weighted_combos).toLocaleString("en-US");
  return `${reaching} of ${formatCombos(range.combos)} reach this node`;
}

export function NodeActionsPanel({ node, hand, filters = [], onToggleFilter }: NodeActionsPanelProps) {
  const shares = sharesByPosition(node.actions, node.range_by_action);
  const combos = shares.kind === "ok" ? combosByPosition(node.actions, node.range_by_action) : null;
  const note = rangeNote(node);
  return (
    <div className="flex flex-col gap-4">
      {shares.kind === "ok" ? (
        <ActionFrequencyTable
          actions={node.actions}
          frequencies={shares.shares}
          caption={RANGE_TABLE_CAPTION}
          {...(combos === null ? {} : { combos })}
          {...(note === undefined ? {} : { note })}
          {...(onToggleFilter === undefined ? {} : { pressedIndexes: filters, onToggle: onToggleFilter })}
        />
      ) : (
        <p role="alert" className="text-danger">{`Cannot show the range by action: ${shares.problem}.`}</p>
      )}
      {hand === undefined ? null : <HandRow node={node} hand={hand} filters={filters} />}
    </div>
  );
}
