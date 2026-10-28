/**
 * The leak-cost trend (S32, R4.12, 06 section 7, O-320, O-321): where the player loses the most,
 * week by week, for the top ten classes.
 *
 * Form (plan section 2): ten series exceed the eight categorical slots, so not a line per class on
 * one plot: small multiples, one ranked row per class with its rank, its label (the joined heat
 * map cell's family and pair plus format and depth), its current cost in words (bb per 1,000
 * hands), a sparkline on the scale every row shares (leak-model.ts) and a "Drill this spot"
 * button. A row whose class has no heat map cell has no button and says why. The weeks selector
 * (4, 8 or 26) sits in one row above. The rows are the one accessible representation (S36 review,
 * O-347): each sparkline's name states every week's value, the partial week and the gaps, and its
 * tooltip shows the same numbers to sighted users; no second table repeats them. With no items
 * the card says how to get some.
 */
import { formatLeak } from "../../progress/format.js";
import { joinLeaksToCells, sharedLeakScale, type LeakRow } from "../../progress/leak-model.js";
import { drillTargetOf, type DrillTarget } from "../../progress/open-drill.js";
import { LEAK_WEEK_OPTIONS, type LeakWeeks, type ProgressHeatmap, type ProgressLeaks } from "../../progress/types.js";
import { Button, ToggleGroup } from "../ui/index.js";
import { DrillAlert } from "./DrillAlert.js";
import { ProgressCard } from "./ProgressCard.js";
import { Sparkline } from "./Sparkline.js";

export const NO_LEAKS_TEXT = "No leaks yet: finish an automated session to see where you lose the most";
export const DRILL_BUTTON_TEXT = "Drill this spot";
export const OPENING_TEXT = "Opening";
const UNIT = "bb per 1,000 hands";

const WEEK_OPTIONS = LEAK_WEEK_OPTIONS.map((weeks) => ({ value: String(weeks), label: `${weeks} weeks` }));

export interface LeakTrendChartProps {
  leaks: ProgressLeaks;
  /** The heat map read, for the class labels and drills; undefined while it loads. */
  heatmap: ProgressHeatmap | undefined;
  weeks: LeakWeeks;
  onWeeksChange: (weeks: LeakWeeks) => void;
  onDrill: (target: DrillTarget) => void;
  /** The spot_class_key being opened, whose button is disabled. */
  pendingKey?: string | null;
  /** A failed or unmatched drill's text. */
  message?: string | null;
}

function DrillButton({ row, pendingKey, onDrill }: { row: LeakRow; pendingKey: string | null; onDrill: (target: DrillTarget) => void }) {
  if (row.cell === null || row.row === null || row.column === null) {
    return <span className="text-xs text-muted">{row.noDrillReason}</span>;
  }
  const target = drillTargetOf(row.cell, row.row, row.column);
  const pending = pendingKey === row.cell.spot_class_key;
  return (
    <Button size="sm" disabled={pending} aria-label={`${DRILL_BUTTON_TEXT}: ${row.label}`} onClick={() => onDrill(target)}>
      {pending ? OPENING_TEXT : DRILL_BUTTON_TEXT}
    </Button>
  );
}

function LeakRows({ rows, leaks, pendingKey, onDrill }: { rows: readonly LeakRow[]; leaks: ProgressLeaks; pendingKey: string | null; onDrill: (target: DrillTarget) => void }) {
  const scale = sharedLeakScale(leaks.items);
  return (
    <ol className="flex flex-col divide-y divide-border" aria-label="Top leaks by current cost">
      {rows.map((row) => (
        <li key={row.item.spot_class_key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2" data-testid="leak-row">
          <span className="w-6 text-right font-semibold tabular-nums text-muted">{row.rank}</span>
          <span className="flex min-w-0 flex-1 basis-40 flex-col">
            <span className="font-medium">{row.label}</span>
            <span className="text-sm tabular-nums">
              {formatLeak(row.item.leak_cost_bb_per_1k)} {UNIT}
            </span>
          </span>
          <Sparkline item={row.item} scale={scale} label={row.label} />
          <DrillButton row={row} pendingKey={pendingKey} onDrill={onDrill} />
        </li>
      ))}
    </ol>
  );
}

export function LeakTrendChart({ leaks, heatmap, weeks, onWeeksChange, onDrill, pendingKey = null, message = null }: LeakTrendChartProps) {
  const rows = joinLeaksToCells(leaks, heatmap);
  const empty = rows.length === 0;
  const selector = (
    <ToggleGroup
      label="Weeks shown"
      value={String(weeks)}
      options={WEEK_OPTIONS}
      onValueChange={(value) => onWeeksChange(LEAK_WEEK_OPTIONS.find((option) => String(option) === value) ?? weeks)}
    />
  );
  return (
    <ProgressCard title="Leak cost trend" testId="leak-trend" actions={selector}>
      <DrillAlert text={message} />
      {empty ? (
        <p className="text-sm text-muted">{NO_LEAKS_TEXT}</p>
      ) : (
        <LeakRows rows={rows} leaks={leaks} pendingKey={pendingKey} onDrill={onDrill} />
      )}
    </ProgressCard>
  );
}
