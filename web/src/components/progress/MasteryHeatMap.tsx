/**
 * The mastery heat map (S32, R4.12, 06 section 7, O-320, O-321, O-253, ADR 0012).
 *
 * Form (plan section 2): rows are family by position pair, grouped under a family heading in api
 * order; columns are format by depth band in api order. Each cell is a button filled by its
 * p_known bin (the validated five-step ramp, heatmap-model.ts) that also prints p as a percent, so
 * color is never the only signal: a mastered cell adds a check glyph, a never-practiced cell is a
 * hatched texture (a repeating-linear-gradient on the sunken surface token) reading "new", a bar
 * along the bottom edge shows retrievability as its length, and a dot marks a class due for
 * review. One tooltip, shown on hover and on focus, states the class and its p, R, n, mastered and
 * due. A click, Enter or Space opens the class's drill (O-321); mastery gates nothing (ADR 0012).
 * A wide grid scrolls inside the card with the row headers sticky, so the page itself never
 * scrolls sideways at 390 px. A legend explains every mark, and a table of the same values sits
 * beside the grid for screen readers only (S36, O-347: no visible table toggle).
 */
import { useId, useState, type CSSProperties } from "react";

import {
  cellLookup,
  cellViewAt,
  columnLabel,
  groupRowsByFamily,
  HEAT_BIN_LABELS,
  HEAT_BINS,
  HEAT_FILL,
  HEAT_INK,
  type HeatCellView,
} from "../../progress/heatmap-model.js";
import { drillTargetOf, type DrillTarget } from "../../progress/open-drill.js";
import type { ProgressHeatmap } from "../../progress/types.js";
import { cn } from "../ui/index.js";
import { ChartTooltip, useTooltipAnchor } from "./ChartTooltip.js";
import { DrillAlert } from "./DrillAlert.js";
import { ProgressCard } from "./ProgressCard.js";

export const NO_CLASSES_TEXT = "No spot classes in the library yet.";
export const OPEN_DRILL_HINT = "Select a cell to drill that spot.";
const MASTERED_GLYPH = "✓";

/** The never-practiced texture: stripes of the sunken surface token over the raised surface. */
export const NEW_CELL_STYLE: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--surface-sunken) 0 4px, transparent 4px 8px)",
};

export interface MasteryHeatMapProps {
  heatmap: ProgressHeatmap;
  onDrill: (target: DrillTarget) => void;
  pendingKey?: string | null;
  message?: string | null;
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Heat map legend">
      {HEAT_BINS.map((bin) => (
        <li key={bin} className="flex items-center gap-1">
          <span aria-hidden="true" className={cn("size-4 rounded-sm", HEAT_FILL[bin])} />
          {HEAT_BIN_LABELS[bin]}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="size-4 rounded-sm border border-border bg-surface-raised" style={NEW_CELL_STYLE} />
        new: never practiced
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="font-semibold text-text">{MASTERED_GLYPH}</span>
        mastered
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
        due for review
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden="true" className="h-1 w-4 rounded-sm bg-text" />
        bottom bar: recall (retrievability)
      </li>
    </ul>
  );
}

interface CellButtonProps {
  view: HeatCellView;
  pending: boolean;
  describedBy: string | undefined;
  onDrill: (target: DrillTarget) => void;
  onShow: (view: HeatCellView, element: Element) => void;
  onHide: () => void;
}

function CellButton({ view, pending, describedBy, onDrill, onShow, onHide }: CellButtonProps) {
  const practiced = view.bin !== null;
  return (
    <button
      type="button"
      aria-label={view.label}
      aria-describedby={describedBy}
      disabled={pending}
      data-testid="heat-cell"
      data-state={practiced ? "practiced" : "new"}
      onClick={() => onDrill(drillTargetOf(view.cell, view.row, view.column))}
      onMouseEnter={(event) => onShow(view, event.currentTarget)}
      onMouseLeave={onHide}
      onFocus={(event) => onShow(view, event.currentTarget)}
      onBlur={onHide}
      style={practiced ? undefined : NEW_CELL_STYLE}
      className={cn(
        "relative flex h-12 w-20 items-center justify-center gap-1 overflow-hidden rounded-md text-sm font-semibold tabular-nums disabled:opacity-60",
        view.bin === null ? "border border-border bg-surface-raised text-muted" : `${HEAT_FILL[view.bin]} ${HEAT_INK[view.bin]}`,
      )}
    >
      <span>{view.text}</span>
      {view.cell.mastered ? <span aria-hidden="true">{MASTERED_GLYPH}</span> : null}
      {view.due ? <span aria-hidden="true" data-testid="heat-due" className="absolute right-1 top-1 size-2 rounded-full bg-warning ring-1 ring-surface-raised" /> : null}
      {view.recallPercent === null ? null : (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-current/25">
          <span className="block h-full bg-current" style={{ width: `${view.recallPercent}%` }} />
        </span>
      )}
    </button>
  );
}

const STICKY = "sticky left-0 z-10 bg-surface-raised";

function HeatGrid({ heatmap, pendingKey, onDrill }: { heatmap: ProgressHeatmap; pendingKey: string | null; onDrill: (target: DrillTarget) => void }) {
  const lookup = cellLookup(heatmap);
  const tooltipId = useId();
  const tooltip = useTooltipAnchor();
  const [active, setActive] = useState<HeatCellView | null>(null);
  const show = (view: HeatCellView, element: Element) => {
    setActive(view);
    tooltip.show(element);
  };
  const hide = () => {
    setActive(null);
    tooltip.hide();
  };
  const columnCount = heatmap.columns.length + 1;
  return (
    <div className="max-w-full overflow-x-auto" data-testid="heat-grid">
      <table className="border-separate border-spacing-1 text-left text-sm">
        <caption className="sr-only">Mastery by spot class. {OPEN_DRILL_HINT}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(STICKY, "pr-2 text-xs font-medium text-muted")}>Pair</th>
            {heatmap.columns.map((column) => (
              <th key={`${column.format}-${column.depth_band}`} scope="col" className="w-20 text-center text-xs font-medium text-muted">
                {columnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        {groupRowsByFamily(heatmap.rows).map((group) => (
          <tbody key={group.family}>
            <tr>
              <th scope="colgroup" colSpan={columnCount} className="pt-2 text-xs font-semibold text-muted">
                <span className="sticky left-0">{group.family}</span>
              </th>
            </tr>
            {group.rows.map((entry) => (
              <tr key={entry.index}>
                <th scope="row" className={cn(STICKY, "whitespace-nowrap pr-2 font-medium")}>{entry.row.pair}</th>
                {heatmap.columns.map((_, columnIndex) => {
                  const view = cellViewAt(heatmap, lookup, entry.index, columnIndex);
                  return (
                    <td key={columnIndex}>
                      {view === undefined ? null : (
                        <CellButton
                          view={view}
                          pending={pendingKey === view.cell.spot_class_key}
                          describedBy={active?.cell.spot_class_key === view.cell.spot_class_key ? tooltipId : undefined}
                          onDrill={onDrill}
                          onShow={show}
                          onHide={hide}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <ChartTooltip id={tooltipId} anchor={active === null ? null : tooltip.anchor}>
        {active === null ? null : (
          <>
            <p className="font-semibold">{active.classText}</p>
            {active.details.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </>
        )}
      </ChartTooltip>
    </div>
  );
}

function HeatTable({ heatmap }: { heatmap: ProgressHeatmap }) {
  const lookup = cellLookup(heatmap);
  const views = heatmap.rows.flatMap((_, rowIndex) =>
    heatmap.columns.flatMap((__, columnIndex) => cellViewAt(heatmap, lookup, rowIndex, columnIndex) ?? []),
  );
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full text-left text-sm tabular-nums" data-testid="heat-table">
        <caption className="sr-only">Mastery by spot class</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-1 pr-3">Class</th>
            <th scope="col" className="py-1 pr-3">Game</th>
            <th scope="col" className="py-1 pr-3">Known</th>
            <th scope="col" className="py-1 pr-3">Recall</th>
            <th scope="col" className="py-1 pr-3">Attempts</th>
            <th scope="col" className="py-1 pr-3">Mastered</th>
            <th scope="col" className="py-1">Due</th>
          </tr>
        </thead>
        <tbody>
          {views.map((view) => (
            <tr key={view.cell.spot_class_key} className="border-t border-border">
              <th scope="row" className="whitespace-nowrap py-1 pr-3 font-medium">{`${view.row.family} ${view.row.pair}`}</th>
              <td className="whitespace-nowrap py-1 pr-3">{columnLabel(view.column)}</td>
              <td className="py-1 pr-3">{view.text}</td>
              <td className="py-1 pr-3">{view.recallPercent === null ? "not scheduled" : `${view.recallPercent}%`}</td>
              <td className="py-1 pr-3">{view.cell.n}</td>
              <td className="py-1 pr-3">{view.cell.mastered ? "yes" : "no"}</td>
              <td className="py-1">{view.due ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MasteryHeatMap({ heatmap, onDrill, pendingKey = null, message = null }: MasteryHeatMapProps) {
  const empty = heatmap.cells.length === 0;
  return (
    <ProgressCard title="Mastery heat map" testId="mastery-heatmap">
      <DrillAlert text={message} />
      {empty ? (
        <p className="text-sm text-muted">{NO_CLASSES_TEXT}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{OPEN_DRILL_HINT}</p>
          <Legend />
          <HeatGrid heatmap={heatmap} pendingKey={pendingKey} onDrill={onDrill} />
          <div className="sr-only">
            <HeatTable heatmap={heatmap} />
          </div>
        </>
      )}
    </ProgressCard>
  );
}
