/**
 * One study node on screen (S25, S45, R3.12, R3.24, A7 sections 3 and 4).
 *
 * Mechanism: the synthetic banner when the node is synthetic (O-57), who acts and the pot, the
 * noise flags, then for a preflop node the position carousel (S39: the caller's carousel slot,
 * which replaced the line breadcrumb and line steps) and the acting seat's range in the matrix
 * with its lens switch (frequency, EV, range weight, strategy with EV, compare to best; the mode
 * lives in the URL) beside the actions table and the selected hand's threshold card. A lens line
 * under the heading names what the matrix shows. Compare to best adds an action picker (the lens,
 * a NodeAction.index in the URL with replace; a lens naming no action here falls back to the
 * default without rewriting the URL, O-462) and the bar lenses a checkbox that scales the bars
 * by range weight, starting from the node's rule (O-465) and kept for this page only. Selecting a
 * matrix cell writes the hand to the URL; hovering one (R3.25) only swaps the hand row beside the
 * matrix to the hovered hand, in component state, while the insights stay on the selected hand. A node on a later street renders the v1.5 note, a way
 * back (LineEscape) and no carousel or matrix, so RangeMatrix never meets exact-combination rows
 * (O-196) and no button walks further into a postflop subtree (review round 1). After each new
 * node renders, an effect completes the pending node switch timing: React runs the matrix's draw
 * effect first, so the switch's frame comes after the draw's (O-287).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppApi } from "../../api/index.js";
import { MODE_NAMES } from "../../components/range-matrix/cell-text.js";
import {
  BAR_MODES,
  defaultLensPosition,
  defaultScaleByWeightOf,
  lensPositionOf,
  type MatrixMode,
} from "../../components/range-matrix/model.js";
import { RangeMatrix } from "../../components/range-matrix/RangeMatrix.js";
import { ToggleGroup, type ToggleOption } from "../../components/ui/ToggleGroup.js";
import type { StudyNode } from "../../contracts.js";
import { exactActionLabel, formatCbb } from "../../poker/format.js";
import { useThemeStore } from "../../store/theme.js";
import { lineLabel } from "../../study/line.js";
import { useNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import { knownFilters, nextFilterState, parseFilters } from "../../study/action-filters.js";
import { studyModeOf, type StudySearch } from "../../study/search.js";
import { FilterChips } from "./FilterChips.js";
import { HandInsights } from "./HandInsights.js";
import { LineEscape } from "./LineEscape.js";
import { NodeActionsPanel } from "./NodeActionsPanel.js";
import { SyntheticBanner } from "../../components/ui/index.js";
import { NoiseFlags, PostflopNote } from "./StudyNotices.js";
import { useMatrixSize } from "./use-matrix-size.js";

export const MODE_OPTIONS: readonly ToggleOption<MatrixMode>[] = [
  { value: "frequency", label: "Frequency" },
  { value: "ev", label: "EV" },
  { value: "weight", label: "Range weight" },
  { value: "strategy_ev", label: "Strategy with EV" },
  { value: "compare", label: "Compare to Best" },
];

export const LENS_TEXT = {
  compareAction: "Compare action",
  scaleByWeight: "Scale bars by range weight",
  lensLead: "Lens: ",
  againstBest: " against the best action, in percent of the pot",
  evUnit: ", EV in big blinds",
  noCompare: ", no action to compare",
} as const;

export interface NodeViewProps {
  api: AppApi;
  node: StudyNode;
  search: StudySearch;
  /** The position carousel for this node's line; rendered for a preflop node only. */
  carousel: ReactNode;
  onModeChange: (mode: MatrixMode) => void;
  onSelectHand: (hand: string) => void;
  onOpenLine: (line: string) => void;
  /** Compare to best: another action to compare (R3.24). */
  onLensChange: (lens: number) => void;
  /** The action filter set (R3.12, O-468); with `compare`, Compare to Best opens on that action. */
  onFiltersChange: (filters: readonly number[], compare?: number) => void;
}

function useCompleteNodeSwitch(nodeKey: string, preflop: boolean, line: string | undefined): void {
  const metrics = useNodeSwitchMetrics();
  const label = lineLabel(line);
  useEffect(() => {
    if (preflop) metrics.complete(label);
    else metrics.cancel();
  }, [metrics, nodeKey, preflop, label]);
}

/** The scale-by-weight choice: the node's default until the user flips it, per node (O-465). */
function useScaleByWeight(node: StudyNode): [boolean, (next: boolean) => void] {
  // Read from the rows directly: RangeMatrix builds the one model of the node (code review).
  const fallback = useMemo(() => defaultScaleByWeightOf(node), [node]);
  const [override, setOverride] = useState<{ nodeKey: string; value: boolean } | null>(null);
  const value = override !== null && override.nodeKey === node.node_key ? override.value : fallback;
  return [value, (next) => setOverride({ nodeKey: node.node_key, value: next })];
}

/** "Lens: compare to best, Raise to 2.5bb against the best action, in percent of the pot". */
function lensLine(node: StudyNode, mode: MatrixMode, lensPosition: number | null): string {
  const name = `${LENS_TEXT.lensLead}${MODE_NAMES[mode]}`;
  if (mode === "ev" || mode === "strategy_ev") return `${name}${LENS_TEXT.evUnit}`;
  if (mode !== "compare") return name;
  const action = lensPosition === null ? undefined : node.actions[lensPosition];
  return action === undefined ? `${name}${LENS_TEXT.noCompare}` : `${name}, ${exactActionLabel(action)}${LENS_TEXT.againstBest}`;
}

interface LensControlsProps {
  node: StudyNode;
  mode: MatrixMode;
  lensPosition: number | null;
  scaleByWeight: boolean;
  onScaleByWeight: (next: boolean) => void;
  onLensChange: (lens: number) => void;
}

/** The compare action picker in compare mode, the scale checkbox in the bar lenses. */
function LensControls({ node, mode, lensPosition, scaleByWeight, onScaleByWeight, onLensChange }: LensControlsProps) {
  if (mode === "compare") {
    const options = node.actions.map((action) => ({ value: String(action.index), label: exactActionLabel(action) }));
    const current = lensPosition === null ? undefined : node.actions[lensPosition];
    return (
      <ToggleGroup
        label={LENS_TEXT.compareAction}
        value={current === undefined ? undefined : String(current.index)}
        options={options}
        onValueChange={(next) => onLensChange(Number(next))}
        wrap
      />
    );
  }
  if (!BAR_MODES.includes(mode)) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={scaleByWeight} onChange={(event) => onScaleByWeight(event.target.checked)} />
      {LENS_TEXT.scaleByWeight}
    </label>
  );
}

export function NodeView({ api, node, search, carousel, onModeChange, onSelectHand, onOpenLine, onLensChange, onFiltersChange }: NodeViewProps) {
  const theme = useThemeStore((state) => state.theme);
  const sizePx = useMatrixSize();
  const preflop = node.street === "preflop";
  const mode = studyModeOf(search);
  const lensPosition = lensPositionOf(node.actions, search.lens) ?? defaultLensPosition(node.actions);
  const [scaleByWeight, setScaleByWeight] = useScaleByWeight(node);
  const [hovered, setHovered] = useState<string | null>(null);
  const rowHand = hovered ?? search.hand;
  // Only the indexes that name an action here count (code review): a stale one is ignored, never rewritten.
  const filters = useMemo(() => knownFilters(parseFilters(search), node.actions), [search, node.actions]);
  const toggleFilter = (index: number) => {
    const next = nextFilterState(filters, index);
    onFiltersChange(next.filters, next.compare ?? undefined);
  };
  useCompleteNodeSwitch(node.node_key, preflop, search.line);

  return (
    <div className="flex flex-col gap-4">
      {node.synthetic ? <SyntheticBanner /> : null}
      <p className="text-sm">{`${node.to_act} to act, pot ${formatCbb(node.pot_cbb)}`}</p>
      <NoiseFlags flags={node.noise_flags} />
      {preflop ? carousel : null}
      {preflop ? (
        <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="text-base font-semibold">{`${node.to_act}'s range at this node`}</h2>
            <p data-testid="lens-line" className="text-sm text-muted">
              {lensLine(node, mode, lensPosition)}
            </p>
            <ToggleGroup label="Matrix mode" value={mode} options={MODE_OPTIONS} onValueChange={onModeChange} wrap />
            <LensControls
              node={node}
              mode={mode}
              lensPosition={lensPosition}
              scaleByWeight={scaleByWeight}
              onScaleByWeight={setScaleByWeight}
              onLensChange={onLensChange}
            />
            <FilterChips
              actions={node.actions}
              filters={filters}
              onRemove={(index) => onFiltersChange(filters.filter((kept) => kept !== index))}
              onClear={() => onFiltersChange([])}
            />
            <RangeMatrix
              node={node}
              mode={mode}
              theme={theme}
              sizePx={sizePx}
              selectedHand={search.hand ?? null}
              onSelectHand={onSelectHand}
              lensIndex={search.lens ?? null}
              scaleByWeight={scaleByWeight}
              onHoverHand={setHovered}
              highlightIndexes={filters}
              legendActions={false}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <NodeActionsPanel node={node} hand={rowHand} filters={filters} onToggleFilter={toggleFilter} />
            <HandInsights api={api} node={node} hand={search.hand} />
          </div>
        </div>
      ) : (
        <>
          <PostflopNote street={node.street} />
          <LineEscape line={search.line} onOpenLine={onOpenLine} />
        </>
      )}
    </div>
  );
}
