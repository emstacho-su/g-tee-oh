/**
 * The graded paint (S27 lane B, R3.17, O-300, ADR 0004, A7 section 4): what solver-query's
 * POST /v1/grade-range answered, relayed unchanged by the api, shown after Submit.
 *
 * Mechanism: the same 13 by 13 chart layout, read-only. Each held class's cell prints its painted
 * action and the solver's best action as short letters, is shaded by its weighted loss (bucketed by
 * the named thresholds in paint-model.ts) with a printed marker per bucket, and carries the full
 * sentence ("QQ: painted Call, solver Raise to 10bb, weighted loss 0.0123bb") as its title and as
 * hidden text, so neither color nor hover is the only signal. A legend names the buckets. Below,
 * the total weighted EV loss in bb per hand dealt and a table of the ten costliest classes
 * (ordered, never recomputed). Every number shown is the response's, formatted only.
 */
import type { NodeAction, RangePaintPrompt, RangePaintResult } from "../../contracts.js";
import { formatBb, formatShare } from "../../poker/format.js";
import { GRID_SIZE, HAND_GRID } from "../../poker/hands.js";
import { actionStyle } from "../../theme/action-style.js";
import { Button, VisuallyHidden, cn } from "../ui/index.js";
import { NOT_IN_RANGE } from "./PaintGrid.js";
import { LOSS_SHADE_BB, costliest, lossShade, type HandGrade, type LossShade } from "./paint-model.js";

/**
 * One precision for every big-blind figure on the screen (S47 critic G6; PR #48 review HIGH 1):
 * the total, the loss and the weighted loss all go through bbText at four decimals, because a
 * weighted loss is often a few thousandths of a big blind (a 6/1326 weight times 0.5bb is about
 * 0.0023bb), which two decimals would print as 0.00bb.
 */
const BB_DECIMALS = 4;
const WEIGHT_DECIMALS = 2;

function bbText(value: number): string {
  return formatBb(value, BB_DECIMALS);
}

export const GRADED_TEXT = {
  heading: "Graded range",
  /** The cell codes' key (S47 critic G4): the painted letter, then the solver's. */
  codeKey: "Each cell: your action / the solver's action (F fold, C call, X check, B bet, R raise, A all-in), then the loss marker.",
  total: "Total weighted EV loss",
  totalUnit: "per hand dealt to this spot",
  unrated: "Range painting is unrated practice: it writes no attempt and never changes your rating.",
  costliest: "Costliest classes",
  noLoss: "Every class was painted at an action that loses nothing.",
  next: "Next range",
} as const;

interface ShadeStyle {
  readonly label: string;
  readonly marker: string;
  readonly classes: string;
}

const SHADES: Readonly<Record<LossShade, ShadeStyle>> = {
  none: { label: "No loss", marker: "", classes: "bg-surface-raised text-text" },
  low: { label: `Under ${LOSS_SHADE_BB.medium}bb`, marker: "·", classes: "bg-amber-100 text-black dark:bg-amber-900 dark:text-white" },
  medium: {
    label: `${LOSS_SHADE_BB.medium}bb to under ${LOSS_SHADE_BB.high}bb`,
    marker: "!",
    classes: "bg-orange-300 text-black dark:bg-orange-700 dark:text-white",
  },
  high: { label: `${LOSS_SHADE_BB.high}bb or more`, marker: "!!", classes: "bg-red-600 text-white dark:bg-red-700" },
};
const SHADE_ORDER: readonly LossShade[] = ["none", "low", "medium", "high"];

const ROWS = Array.from({ length: GRID_SIZE }, (_, row) => HAND_GRID.slice(row * GRID_SIZE, (row + 1) * GRID_SIZE));

export interface PaintGradedViewProps {
  prompt: Pick<RangePaintPrompt, "actions">;
  result: RangePaintResult;
  onNext: () => void;
}

function labelOf(actions: readonly NodeAction[], index: number): string {
  return actions.find((action) => action.index === index)?.label ?? `Action ${index}`;
}

function shortOf(actions: readonly NodeAction[], index: number): string {
  const action = actions.find((candidate) => candidate.index === index);
  return action === undefined ? "?" : actionStyle(action.kind).short;
}

function describeGrade(actions: readonly NodeAction[], grade: HandGrade): string {
  return `${grade.hand}: painted ${labelOf(actions, grade.action_index)}, solver ${labelOf(actions, grade.best_action_index)}, weighted loss ${bbText(grade.weighted_loss_bb)}`;
}

interface GradedCellProps {
  hand: string;
  grade: HandGrade | undefined;
  actions: readonly NodeAction[];
}

function GradedCell({ hand, grade, actions }: GradedCellProps) {
  if (grade === undefined) {
    return (
      <div role="gridcell" title={`${hand}: ${NOT_IN_RANGE}`} className="flex aspect-square flex-col items-center justify-center rounded-sm bg-surface-sunken font-mono text-[0.6rem] text-muted line-through sm:text-xs">
        <span aria-hidden="true">{hand}</span>
        <VisuallyHidden>{`${hand}: ${NOT_IN_RANGE}`}</VisuallyHidden>
      </div>
    );
  }
  const shade = lossShade(grade.weighted_loss_bb);
  const text = describeGrade(actions, grade);
  return (
    <div role="gridcell" title={text} data-shade={shade} className={cn("flex aspect-square flex-col items-center justify-center rounded-sm border border-black/10 font-mono text-[0.6rem] leading-tight sm:text-xs", SHADES[shade].classes)}>
      <span aria-hidden="true">{hand}</span>
      <span aria-hidden="true" className="font-bold">
        {shortOf(actions, grade.action_index)}/{shortOf(actions, grade.best_action_index)}
        {SHADES[shade].marker}
      </span>
      <VisuallyHidden>{text}</VisuallyHidden>
    </div>
  );
}

function ShadeLegend() {
  return (
    <>
    <p data-testid="paint-code-key" className="text-sm text-muted">
      {GRADED_TEXT.codeKey}
    </p>
    <ul aria-label="Loss shading" className="flex flex-wrap gap-3 text-sm">
      {SHADE_ORDER.map((shade) => (
        <li key={shade} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-black/20 px-0.5 font-mono text-xs font-bold", SHADES[shade].classes)}>
            {SHADES[shade].marker}
          </span>
          {SHADES[shade].label}
        </li>
      ))}
    </ul>
    </>
  );
}

const COSTLIEST_HEADERS = ["Class", "Painted", "Solver", "Loss", "Weight", "Weighted loss"] as const;
const COSTLIEST_CELL = "px-2 py-1 align-top";

/** A figure cell: its column name shows beside it at phone width, where the header row is hidden. */
function CostliestCell({ label, children }: { label: string; children: string }) {
  return (
    <td className={cn(COSTLIEST_CELL, "tabular-nums")}>
      <span className="text-muted sm:sr-only">{`${label}: `}</span>
      {children}
    </td>
  );
}

interface CostliestTableProps {
  rows: readonly HandGrade[];
  actions: readonly NodeAction[];
}

function CostliestTable({ rows, actions }: CostliestTableProps) {
  if (rows.length === 0) return <p className="text-sm">{GRADED_TEXT.noLoss}</p>;
  return (
    // Padded cells, and at phone width each row stacks its figures under the class (S47 critic G2).
    <table className="w-full max-w-2xl text-left text-sm max-sm:block" data-testid="paint-costliest">
      <caption className="pb-1 text-left font-semibold max-sm:block">{GRADED_TEXT.costliest}</caption>
      <thead className="max-sm:sr-only">
        <tr className="text-muted">
          {COSTLIEST_HEADERS.map((header) => (
            <th key={header} scope="col" className={COSTLIEST_CELL}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-sm:flex max-sm:flex-col max-sm:gap-2">
        {rows.map((row) => (
          <tr key={row.hand} className="border-t border-border max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:py-1">
            <th scope="row" className={cn(COSTLIEST_CELL, "font-mono max-sm:col-span-2")}>
              {row.hand}
            </th>
            <CostliestCell label="Painted">{labelOf(actions, row.action_index)}</CostliestCell>
            <CostliestCell label="Solver">{labelOf(actions, row.best_action_index)}</CostliestCell>
            <CostliestCell label="Loss">{bbText(row.loss_bb)}</CostliestCell>
            <CostliestCell label="Weight">{formatShare(row.weight, WEIGHT_DECIMALS)}</CostliestCell>
            <CostliestCell label="Weighted loss">{bbText(row.weighted_loss_bb)}</CostliestCell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaintGradedView({ prompt, result, onNext }: PaintGradedViewProps) {
  const byHand = new Map(result.per_hand.map((row) => [row.hand, row]));
  return (
    <section aria-label={GRADED_TEXT.heading} className="flex flex-col gap-4" data-testid="paint-graded">
      <p data-testid="paint-total" className="text-lg">
        <span className="font-semibold">{GRADED_TEXT.total}: </span>
        <span className="tabular-nums">{bbText(result.total_weighted_loss_bb)}</span> {GRADED_TEXT.totalUnit}
      </p>
      <p role="note" className="text-sm text-muted">
        {GRADED_TEXT.unrated}
      </p>
      <ShadeLegend />
      <div role="grid" aria-label={GRADED_TEXT.heading} aria-readonly="true" className="grid w-full max-w-[36rem] gap-px">
        {ROWS.map((cells, row) => (
          <div role="row" key={row} className="grid grid-cols-13 gap-px">
            {cells.map((cell) => (
              <GradedCell key={cell.hand} hand={cell.hand} grade={byHand.get(cell.hand)} actions={prompt.actions} />
            ))}
          </div>
        ))}
      </div>
      <CostliestTable rows={costliest(result.per_hand)} actions={prompt.actions} />
      <Button variant="primary" className="self-start" onClick={onNext}>
        {GRADED_TEXT.next}
      </Button>
    </section>
  );
}
