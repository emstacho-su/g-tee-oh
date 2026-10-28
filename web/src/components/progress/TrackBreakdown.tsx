/**
 * The per-track rating breakdown (S32, R4.12, 06 section 7, O-320, O-271, ADR 0011).
 *
 * Form (plan section 2): one row per track, a dot for mu with a whisker of plus or minus RD, every
 * row on one shared horizontal axis so the rows compare at a glance; single neutral ink for the
 * whisker and the accent for the dot, no categorical colors. Dashed lines mark the tier floors
 * (packages/learning TIER_FLOORS, the bands the overall rating ranks on) that fall inside the
 * axis. Each row also states its figures in words: rating with deviation, conservative rating,
 * weight and rated decisions. A track with weight 0 has no covered class: its row is dimmed and
 * says "no coverage", never color alone. A table of the same figures sits beside the chart for
 * screen readers only (S36, O-347: no visible table toggle). Built as positioned HTML, so the axis
 * stretches with the card at any width.
 */
import { TIER_FLOORS } from "@g-tee-oh/learning";

import { formatDeviation, formatPercent, formatRating } from "../../progress/format.js";
import type { TrackProgress } from "../../progress/types.js";
import { cn } from "../ui/index.js";
import { ProgressCard } from "./ProgressCard.js";

export const NO_COVERAGE_TEXT = "no coverage";
export const NO_TRACKS_TEXT = "No rating tracks yet.";
/** The axis ends snap to this many rating points. */
export const AXIS_STEP = 100;
const PERCENT = 100;

export interface RatingAxis {
  readonly min: number;
  readonly max: number;
}

/** One axis over every track's mu plus and minus RD, snapped out to AXIS_STEP. */
export function ratingAxis(tracks: readonly TrackProgress[]): RatingAxis {
  const low = Math.min(...tracks.map((track) => track.mu - track.rd));
  const high = Math.max(...tracks.map((track) => track.mu + track.rd));
  const min = Math.floor(low / AXIS_STEP) * AXIS_STEP;
  const max = Math.ceil(high / AXIS_STEP) * AXIS_STEP;
  return { min, max: max > min ? max : min + AXIS_STEP };
}

function at(value: number, axis: RatingAxis): string {
  return `${((value - axis.min) / (axis.max - axis.min)) * PERCENT}%`;
}

function floorsIn(axis: RatingAxis) {
  return TIER_FLOORS.filter((floor) => Number.isFinite(floor.floor) && floor.floor > axis.min && floor.floor < axis.max);
}

function Floors({ axis }: { axis: RatingAxis }) {
  return (
    <>
      {floorsIn(axis).map((floor) => (
        <span key={floor.tier} aria-hidden="true" className="absolute inset-y-0 border-l border-dashed border-border" style={{ left: at(floor.floor, axis) }} />
      ))}
    </>
  );
}

function AxisRow({ axis }: { axis: RatingAxis }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,16rem)_1fr]">
      <span className="hidden sm:block" />
      <div className="relative h-5 text-xs text-muted tabular-nums">
        <span className="absolute left-0">{axis.min}</span>
        <span className="absolute right-0">{axis.max}</span>
        {floorsIn(axis).map((floor) => (
          <span key={floor.tier} className="absolute -translate-x-1/2" style={{ left: at(floor.floor, axis) }}>
            {floor.tier}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrackRow({ track, axis }: { track: TrackProgress; axis: RatingAxis }) {
  const uncovered = track.weight === 0;
  return (
    <li className={cn("grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,16rem)_1fr]", uncovered && "opacity-60")} data-testid="track-row">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{track.name}</span>
        <span className="text-xs text-muted tabular-nums">
          {formatRating(track.mu)} {formatDeviation(track.rd)}, conservative {formatRating(track.conservative)}, weight {formatPercent(track.weight)},{" "}
          {track.rated_decisions} rated decisions{uncovered ? `, ${NO_COVERAGE_TEXT}` : ""}
        </span>
      </div>
      <div className="relative h-6" aria-hidden="true">
        <Floors axis={axis} />
        <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-muted" style={{ left: at(track.mu - track.rd, axis), width: at(axis.min + 2 * track.rd, axis) }} />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-raised bg-accent" style={{ left: at(track.mu, axis) }} />
      </div>
    </li>
  );
}

function TrackTable({ tracks }: { tracks: readonly TrackProgress[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums">
        <caption className="sr-only">Rating by track</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-1 pr-3">Track</th>
            <th scope="col" className="py-1 pr-3">Rating</th>
            <th scope="col" className="py-1 pr-3">Deviation</th>
            <th scope="col" className="py-1 pr-3">Conservative</th>
            <th scope="col" className="py-1 pr-3">Weight</th>
            <th scope="col" className="py-1">Rated decisions</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <tr key={track.track_key} className="border-t border-border">
              <th scope="row" className="py-1 pr-3 font-medium">{track.name}</th>
              <td className="py-1 pr-3">{formatRating(track.mu)}</td>
              <td className="py-1 pr-3">{formatDeviation(track.rd)}</td>
              <td className="py-1 pr-3">{formatRating(track.conservative)}</td>
              <td className="py-1 pr-3">{track.weight === 0 ? `0%, ${NO_COVERAGE_TEXT}` : formatPercent(track.weight)}</td>
              <td className="py-1">{track.rated_decisions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TrackBreakdownProps {
  tracks: readonly TrackProgress[];
}

export function TrackBreakdown({ tracks }: TrackBreakdownProps) {
  if (tracks.length === 0) {
    return (
      <ProgressCard title="Tracks" testId="track-breakdown">
        <p className="text-sm text-muted">{NO_TRACKS_TEXT}</p>
      </ProgressCard>
    );
  }
  const axis = ratingAxis(tracks);
  return (
    <ProgressCard title="Tracks" testId="track-breakdown">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">Dot: rating. Line: plus or minus the deviation. Dashed lines: tier floors, named above the axis.</p>
        <AxisRow axis={axis} />
        <ul className="flex flex-col gap-3">
          {tracks.map((track) => (
            <TrackRow key={track.track_key} track={track} axis={axis} />
          ))}
        </ul>
      </div>
      <div className="sr-only">
        <TrackTable tracks={tracks} />
      </div>
    </ProgressCard>
  );
}
