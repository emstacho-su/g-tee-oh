/**
 * One class's weekly leak-cost sparkline (S32, R4.12, O-320): a 2 px line in the accent on the
 * shared y-scale the whole trend uses, a gap for a week with no value, and the partial current
 * week as a hollow marker.
 *
 * Mechanism: the geometry comes from leak-model.ts. The SVG is focusable: hovering moves a
 * crosshair to the nearest week, focus starts it at the last week and the left and right arrow
 * keys step it, and a tooltip states the week and its value ("this week (partial)" for the live
 * week, "no data" for a gap). The image's name lists every week the same way (S36 review), so
 * nothing rests on the shape alone and no second table repeats it. Colors are Tailwind token
 * utilities, so both themes follow.
 */
import { useId, useState, type KeyboardEvent, type MouseEvent } from "react";

import { formatLeak, formatShortDate } from "../../progress/format.js";
import { sparklineGeometry, type LeakScale, type SparkBox } from "../../progress/leak-model.js";
import type { LeakItem } from "../../progress/types.js";
import { ChartTooltip, useTooltipAnchor } from "./ChartTooltip.js";

export const SPARK_BOX: SparkBox = { width: 168, height: 40, inset: 5 };
export const PARTIAL_WEEK_TEXT = "this week (partial)";
export const NO_DATA_TEXT = "no data";
const MARKER_RADIUS = 3.5;
const UNIT = "bb per 1,000 hands";

export interface SparklineProps {
  item: LeakItem;
  scale: LeakScale;
  /** The class's label, for the image's accessible name. */
  label: string;
}

function weekText(item: LeakItem, index: number): string {
  const point = item.series[index];
  if (point === undefined) return "";
  const week = point.partial ? `${formatShortDate(point.week)}, ${PARTIAL_WEEK_TEXT}` : `Week of ${formatShortDate(point.week)}`;
  const value = point.leak_cost_bb_per_1k === null ? NO_DATA_TEXT : `${formatLeak(point.leak_cost_bb_per_1k)} ${UNIT}`;
  return `${week}: ${value}`;
}

/**
 * The image's name: every week in order with its value, the partial week and the gaps named (S36
 * review). With the table gone this is the screen-reader view of the line (O-347), the same words
 * the tooltip shows week by week.
 */
function summary(item: LeakItem, label: string): string {
  return `${label}: ${item.series.map((_, index) => weekText(item, index)).join("; ")}`;
}

function nearestIndex(weekX: readonly number[], x: number): number {
  return weekX.reduce((best, candidate, index) => (Math.abs(candidate - x) < Math.abs((weekX[best] ?? 0) - x) ? index : best), 0);
}

export function Sparkline({ item, scale, label }: SparklineProps) {
  const geometry = sparklineGeometry(item, scale, SPARK_BOX);
  const tooltipId = useId();
  const tooltip = useTooltipAnchor();
  const [active, setActive] = useState<number | null>(null);
  const lastIndex = item.series.length - 1;

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.width === 0 ? 0 : ((event.clientX - box.left) / box.width) * SPARK_BOX.width;
    setActive(nearestIndex(geometry.weekX, x));
    tooltip.show(event.currentTarget);
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActive((current) => Math.min(Math.max((current ?? lastIndex) + step, 0), lastIndex));
  };
  const hide = () => {
    setActive(null);
    tooltip.hide();
  };
  const activeX = active === null ? null : geometry.weekX[active];

  return (
    <span className="relative inline-flex">
      <svg
        role="img"
        aria-label={summary(item, label)}
        aria-describedby={active === null ? undefined : tooltipId}
        tabIndex={0}
        width={SPARK_BOX.width}
        height={SPARK_BOX.height}
        viewBox={`0 0 ${SPARK_BOX.width} ${SPARK_BOX.height}`}
        className="shrink-0 overflow-visible rounded-sm"
        data-testid="leak-sparkline"
        onMouseMove={onMove}
        onMouseLeave={hide}
        onFocus={(event) => {
          setActive(lastIndex);
          tooltip.show(event.currentTarget);
        }}
        onBlur={hide}
        onKeyDown={onKey}
      >
        <line x1={0} x2={SPARK_BOX.width} y1={SPARK_BOX.height - SPARK_BOX.inset} y2={SPARK_BOX.height - SPARK_BOX.inset} className="stroke-border" strokeWidth={1} />
        {activeX === undefined || activeX === null ? null : (
          <line x1={activeX} x2={activeX} y1={0} y2={SPARK_BOX.height} className="stroke-muted" strokeWidth={1} strokeDasharray="2 2" />
        )}
        {geometry.segments.map((segment) => (
          <polyline
            key={segment[0]?.index}
            points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
            className="fill-none stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {geometry.points
          .filter((point) => !point.partial)
          .map((point) => (
            <circle key={point.index} cx={point.x} cy={point.y} r={1.5} className="fill-accent" />
          ))}
        {geometry.partialPoint === null ? null : (
          <circle
            cx={geometry.partialPoint.x}
            cy={geometry.partialPoint.y}
            r={MARKER_RADIUS}
            className="fill-surface-raised stroke-accent"
            strokeWidth={2}
            data-testid="leak-partial-marker"
          />
        )}
      </svg>
      <ChartTooltip id={tooltipId} anchor={active === null ? null : tooltip.anchor}>
        {active === null ? null : weekText(item, active)}
      </ChartTooltip>
    </span>
  );
}
