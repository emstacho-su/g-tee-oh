/**
 * One study node on screen (S25, R3.12, A7 sections 3 and 4).
 *
 * Mechanism: the synthetic banner when the node is synthetic (O-57), who acts and the pot, the
 * noise flags, then for a preflop node the matrix with its mode switch (frequency, EV, range
 * weight; the mode lives in the URL) beside the actions tables, the line steps and the selected
 * hand's threshold card. Selecting a matrix cell writes the hand to the URL. A node on a later
 * street renders the v1.5 note and no matrix, so RangeMatrix never meets exact-combination rows
 * (O-196). After each new node renders, an effect completes the pending node switch timing:
 * React runs the matrix's draw effect first, so the switch's frame comes after the draw's (O-287).
 */
import { useEffect } from "react";

import type { AppApi } from "../../api/index.js";
import type { MatrixMode } from "../../components/range-matrix/model.js";
import { RangeMatrix } from "../../components/range-matrix/RangeMatrix.js";
import { ToggleGroup, type ToggleOption } from "../../components/ui/ToggleGroup.js";
import type { StudyNode } from "../../contracts.js";
import { formatCbb } from "../../poker/format.js";
import { useThemeStore } from "../../store/theme.js";
import { lineLabel } from "../../study/line.js";
import { useNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import { studyModeOf, type StudySearch } from "../../study/search.js";
import { HandInsights } from "./HandInsights.js";
import { LineActions } from "./LineActions.js";
import { NodeActionsPanel } from "./NodeActionsPanel.js";
import { NoiseFlags, PostflopNote, SyntheticBanner } from "./StudyNotices.js";
import { useMatrixSize } from "./use-matrix-size.js";

export const MODE_OPTIONS: readonly ToggleOption<MatrixMode>[] = [
  { value: "frequency", label: "Frequency" },
  { value: "ev", label: "EV" },
  { value: "weight", label: "Range weight" },
];

export interface NodeViewProps {
  api: AppApi;
  node: StudyNode;
  search: StudySearch;
  onModeChange: (mode: MatrixMode) => void;
  onSelectHand: (hand: string) => void;
}

function useCompleteNodeSwitch(nodeKey: string, preflop: boolean, line: string | undefined): void {
  const metrics = useNodeSwitchMetrics();
  const label = lineLabel(line);
  useEffect(() => {
    if (preflop) metrics.complete(label);
    else metrics.cancel();
  }, [metrics, nodeKey, preflop, label]);
}

export function NodeView({ api, node, search, onModeChange, onSelectHand }: NodeViewProps) {
  const theme = useThemeStore((state) => state.theme);
  const sizePx = useMatrixSize();
  const preflop = node.street === "preflop";
  const mode = studyModeOf(search);
  useCompleteNodeSwitch(node.node_key, preflop, search.line);

  return (
    <div className="flex flex-col gap-4">
      {node.synthetic ? <SyntheticBanner /> : null}
      <p className="text-sm">{`${node.to_act} to act, pot ${formatCbb(node.pot_cbb)}`}</p>
      <NoiseFlags flags={node.noise_flags} />
      {preflop ? (
        <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <ToggleGroup label="Matrix mode" value={mode} options={MODE_OPTIONS} onValueChange={onModeChange} />
            <RangeMatrix
              node={node}
              mode={mode}
              theme={theme}
              sizePx={sizePx}
              selectedHand={search.hand ?? null}
              onSelectHand={onSelectHand}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <NodeActionsPanel node={node} hand={search.hand} />
            <LineActions node={node} search={search} />
            <HandInsights api={api} node={node} hand={search.hand} />
          </div>
        </div>
      ) : (
        <PostflopNote street={node.street} />
      )}
    </div>
  );
}
