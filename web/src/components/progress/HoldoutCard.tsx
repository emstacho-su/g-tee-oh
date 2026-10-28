/**
 * The holdout card (S32, R4.12, 06 section 7, O-276, O-277, O-328): the monthly retest that the
 * rating never trains on, so it shows whether a rating rise is real.
 *
 * Mechanism: the open round shows answered of total with a native meter and the percent in text.
 * Below it, the newest closed round of each track (the api lists rounds newest first, so the first
 * closed round naming a track wins): the track's name, answered of total, mean score as a percent
 * and the track rating at the close. A track whose rating rose while its holdout score stayed flat
 * carries the Goodhart flag (O-277) as a warning icon plus the words "Rating rose while holdout
 * stayed flat", never color alone. With no round at all the card says so. The action slot is for
 * the retest button (O-328, lane B); nothing is passed there yet.
 */
import type { ReactNode } from "react";

import { formatMonth, formatPercent, formatRating, trackName } from "../../progress/format.js";
import type { HoldoutRound, HoldoutTrack, ProgressHoldout, TrackKey } from "../../progress/types.js";
import { ProgressCard } from "./ProgressCard.js";

export const NO_HOLDOUT_TEXT = "No holdout round yet";
export const GOODHART_TEXT = "Rating rose while holdout stayed flat";

export interface HoldoutCardProps {
  holdout: ProgressHoldout;
  trackNames?: Readonly<Partial<Record<TrackKey, string>>>;
  /** The retest button's slot (O-328). */
  action?: ReactNode;
}

export interface LatestTrackResult {
  readonly round: HoldoutRound;
  readonly track: HoldoutTrack;
}

/** The newest closed round's result for each track, in the order tracks first appear. */
export function latestClosedByTrack(rounds: readonly HoldoutRound[]): LatestTrackResult[] {
  const closed = rounds.filter((round) => round.closed_at !== null);
  const seen = new Set<TrackKey>();
  return closed.flatMap((round) =>
    round.tracks.flatMap((track) => {
      if (seen.has(track.track_key)) return [];
      seen.add(track.track_key);
      return [{ round, track }];
    }),
  );
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0 fill-warning">
      <path d="M8 1 15 14H1L8 1Zm-.75 5v4h1.5V6h-1.5Zm0 5v1.5h1.5V11h-1.5Z" />
    </svg>
  );
}

function OpenRound({ open }: { open: NonNullable<ProgressHoldout["open"]> }) {
  const fraction = open.total === 0 ? 0 : open.answered / open.total;
  return (
    <div className="flex flex-col gap-1" data-testid="holdout-open">
      <p className="text-sm font-medium">{formatMonth(open.round_month)} round, open</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <meter min={0} max={Math.max(open.total, 1)} value={open.answered} className="h-3 w-32" />
        <span className="tabular-nums">
          {open.answered} of {open.total} answered ({formatPercent(fraction)})
        </span>
      </label>
    </div>
  );
}

function TrackResult({ result, trackNames }: { result: LatestTrackResult; trackNames: HoldoutCardProps["trackNames"] }) {
  const { round, track } = result;
  return (
    <li className="flex flex-col gap-0.5 border-t border-border pt-2" data-testid="holdout-track">
      <span className="font-medium">
        {trackName(track.track_key, trackNames)} <span className="text-sm font-normal text-muted">({formatMonth(round.round_month)})</span>
      </span>
      <span className="text-sm tabular-nums">
        {track.answered} of {track.total} answered, mean score {track.mean_score === null ? "none" : formatPercent(track.mean_score)}, rating at
        close {track.mu === null ? "none" : formatRating(track.mu)}
      </span>
      {track.goodhart_flag ? (
        <span className="flex items-center gap-1 text-sm font-medium" data-testid="goodhart-flag">
          <WarningIcon />
          {GOODHART_TEXT}
        </span>
      ) : null}
    </li>
  );
}

export function HoldoutCard({ holdout, trackNames, action }: HoldoutCardProps) {
  const latest = latestClosedByTrack(holdout.items);
  const empty = holdout.open === null && latest.length === 0;
  return (
    <ProgressCard title="Holdout retest" testId="holdout-card" actions={action}>
      {empty ? <p className="text-sm text-muted">{NO_HOLDOUT_TEXT}</p> : null}
      {holdout.open === null ? null : <OpenRound open={holdout.open} />}
      {latest.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Latest closed round per track</p>
          <ul className="flex flex-col gap-2">
            {latest.map((result) => (
              <TrackResult key={result.track.track_key} result={result} trackNames={trackNames} />
            ))}
          </ul>
        </div>
      )}
    </ProgressCard>
  );
}
