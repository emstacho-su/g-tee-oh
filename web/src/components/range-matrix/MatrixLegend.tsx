/**
 * The range matrix legend, one per lens (S38, S45, R3.12, R3.24, O-384, O-385, O-464, A7 section 4).
 *
 * Mechanism: DOM, so it is text a screen reader and a sighted reader both read. Frequency mode
 * lists every action with its swatch (colour and pattern) and the api's label, plus its short
 * letter and pattern name for screen readers; strategy with EV adds the line that says the corner
 * prints the best action's EV. Expected value (EV) mode shows the eleven steps of the diverging
 * scale as a stepped bar with the bb boundary under each swatch, the neutral middle named
 * "near 0", and each step's whole range as the list item's text (scales.ts evLegend). Weight mode
 * shows the empty ground and the five heat steps with their percent ranges. Compare to best names
 * the compared action and shows the best plus five loss steps in percent of the pot on the EV
 * palette's negative side. The swatches use the same palette as the canvas (matrix-theme.ts), so
 * the legend always matches the cells. The component is memoized on its props, which come from the
 * memoized per-node model, so a focus move or a selection change in RangeMatrix does not re-render it.
 */
import { memo } from "react";

import type { NodeAction } from "../../contracts.js";
import { exactActionLabel } from "../../poker/format.js";
import { actionStyle, type ThemeName } from "../../theme/action-style.js";
import { ActionSwatch } from "../trainer/ActionSwatch.js";
import { VisuallyHidden } from "../ui/index.js";
import { actionShortLabel } from "./cell-text.js";
import { MATRIX_PALETTES, evFill, lossFill } from "./matrix-theme.js";
import type { MatrixMode } from "./model.js";
import { COMPARE_NEUTRAL_PCT_POT, COMPARE_STEPS, EV_NEUTRAL_BB, EV_STEPS, compareLegend, evLegend, weightLegend, type LegendStep } from "./scales.js";

export interface MatrixLegendProps {
  mode: MatrixMode;
  actions: readonly NodeAction[];
  theme: ThemeName;
  evScaleBb: number;
  /** Compare to best: the compared action's position and the scale end for it; null when none can be compared. */
  lens?: { readonly position: number; readonly scalePctPot: number } | null;
  /** Leaves the action rows out where an action table beside the matrix is the legend (S45, design rule 3). */
  hideActions?: boolean;
}

export const LEGEND_TEXT = {
  strategyEv: "Each cell's corner prints the best action's EV in bb.",
  noCompare: "No action to compare at this node.",
  compareLabel: "Compare legend: the chosen action's loss against the best in percent of the pot",
} as const;

function ActionLegend({ actions, note }: { actions: readonly NodeAction[]; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Action legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {actions.map((action) => (
          <li key={action.index} className="flex items-center gap-1.5">
            <ActionSwatch action={action} actions={actions} showLetter={false} />
            <span>{action.label}</span>
            <VisuallyHidden>{`(${actionShortLabel(action)}, ${actionStyle(action.kind).pattern} pattern)`}</VisuallyHidden>
          </li>
        ))}
      </ul>
      {note === undefined ? null : <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

interface StepBarProps {
  label: string;
  caption: string;
  steps: readonly LegendStep[];
  fillOf: (step: number) => string;
}

/** A stepped bar: one swatch per step, its tick printed under it, its range as the item's text. */
function StepBar({ label, caption, steps, fillOf }: StepBarProps) {
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label={label} className="grid auto-cols-fr grid-flow-col gap-px text-[10px] leading-tight text-muted">
        {steps.map((entry) => (
          <li key={entry.step} className="flex min-w-0 flex-col items-center gap-0.5">
            <span aria-hidden="true" style={{ backgroundColor: fillOf(entry.step) }} className="block h-3 w-full rounded-sm border border-border/60" />
            <span aria-hidden="true" className="tabular-nums">
              {entry.short}
            </span>
            <VisuallyHidden>{entry.long}</VisuallyHidden>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{caption}</p>
    </div>
  );
}

/** The heat ramp darkens with weight on the light ground and lightens on the dark one (O-362). */
const WEIGHT_CAPTION_LEAD: Readonly<Record<ThemeName, string>> = { light: "Darker", dark: "Lighter" };

/** The EV a step stands for, at its middle, so evFill gives that step's colour. */
function evAtStep(step: number, scaleBb: number): number {
  return ((Math.abs(step) - 0.5) / EV_STEPS) * scaleBb * Math.sign(step);
}

/** The loss a compare step stands for, at its middle, so lossFill gives that step's colour. */
function lossAtStep(step: number, scalePctPot: number): number {
  return step === 0 ? 0 : ((step - 0.5) / COMPARE_STEPS) * scalePctPot;
}

function CompareLegend({ actions, theme, lens }: Pick<MatrixLegendProps, "actions" | "theme" | "lens">) {
  const palette = MATRIX_PALETTES[theme];
  const action = lens === null || lens === undefined ? undefined : actions[lens.position];
  if (action === undefined || lens === null || lens === undefined) return <p className="text-xs text-muted">{LEGEND_TEXT.noCompare}</p>;
  return (
    <StepBar
      label={LEGEND_TEXT.compareLabel}
      caption={`${exactActionLabel(action)} against the best action: neutral where it is best (within ${COMPARE_NEUTRAL_PCT_POT}% of the pot), deeper brick red the more of the pot it gives up; past ${lens.scalePctPot.toFixed(1)}% the end colour holds.`}
      steps={compareLegend(lens.scalePctPot)}
      fillOf={(step) => lossFill(palette, lossAtStep(step, lens.scalePctPot), lens.scalePctPot)}
    />
  );
}

export const MatrixLegend = memo(function MatrixLegend({ mode, actions, theme, evScaleBb, lens = null, hideActions = false }: MatrixLegendProps) {
  const palette = MATRIX_PALETTES[theme];
  if (mode === "frequency") return hideActions ? null : <ActionLegend actions={actions} />;
  if (mode === "strategy_ev") {
    return hideActions ? <p className="text-xs text-muted">{LEGEND_TEXT.strategyEv}</p> : <ActionLegend actions={actions} note={LEGEND_TEXT.strategyEv} />;
  }
  if (mode === "compare") return <CompareLegend actions={actions} theme={theme} lens={lens} />;
  if (mode === "ev") {
    return (
      <StepBar
        label="EV legend: the best action's expected value in big blinds"
        caption={`Brick red loses, blue wins. Within ${EV_NEUTRAL_BB}bb of 0 is neutral; past ${evScaleBb.toFixed(1)}bb either way the end colour holds.`}
        steps={evLegend(evScaleBb)}
        fillOf={(step) => (step === 0 ? palette.evNeutral : evFill(palette, evAtStep(step, evScaleBb), evScaleBb))}
      />
    );
  }
  return (
    <StepBar
      label="Weight legend: how much of each hand is in the range"
      caption={`${WEIGHT_CAPTION_LEAD[theme]} brown means more of the hand's combos are in the range; an empty cell is not in the range.`}
      steps={weightLegend()}
      fillOf={(step) => (step === 0 ? palette.background : (palette.weightSteps[step - 1] ?? palette.background))}
    />
  );
});
