/**
 * The rating card (S32, R4.12, 06 section 7.3, ADR 0011, O-8, O-252): the overall rating with its
 * deviation band, the conservative figure the tier ranks on, and the tier.
 *
 * Not a chart (dataviz form pass): a hero number. The tier is computed on read by the api; when a
 * track's deviation holds it below the tier its conservative figure alone would give (band_tier),
 * the card says so and names those tracks in text. Before any rated session overall is null and
 * the card says how to get a rating. A badge slot shows the equipped cosmetic badge (O-323), and a
 * footer slot carries a link (the home card links to /progress).
 */
import type { ReactNode } from "react";

import { formatDeviation, formatRating, formatShortDate, tierLabel, trackName } from "../../progress/format.js";
import type { ProgressRating, TrackKey } from "../../progress/types.js";
import { ProgressCard } from "./ProgressCard.js";

export const UNRATED_TEXT = "Unrated";
export const UNRATED_HINT = "Finish an automated training session with rated decisions to get a rating.";

export interface RatingCardProps {
  rating: ProgressRating;
  /** Track names by key, from the tracks read, for the blocked-by note. */
  trackNames?: Readonly<Partial<Record<TrackKey, string>>>;
  badge?: ReactNode;
  footer?: ReactNode;
}

export function RatingCard({ rating, trackNames, badge, footer }: RatingCardProps) {
  const overall = rating.overall;
  return (
    <ProgressCard title="Rating" testId="rating-card" actions={badge}>
      {overall === null ? (
        <div className="flex flex-col gap-1">
          <p className="text-3xl font-semibold" data-testid="rating-value">
            {UNRATED_TEXT}
          </p>
          <p className="text-sm text-muted">{UNRATED_HINT}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums" data-testid="rating-value">
              {formatRating(overall.mu)}
            </span>
            <span className="text-lg text-muted tabular-nums" aria-label={`plus or minus ${formatRating(overall.rd)}`}>
              {formatDeviation(overall.rd)}
            </span>
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-sm font-semibold" data-testid="rating-tier">
              {tierLabel(overall.tier)}
            </span>
            <span className="text-sm text-muted tabular-nums">Conservative rating {formatRating(overall.conservative)}</span>
          </p>
          {overall.band_tier !== overall.tier && overall.blocked_by.length > 0 ? (
            <p className="text-sm text-muted" data-testid="rating-blocked">
              The conservative rating reaches {tierLabel(overall.band_tier)}; it waits until these tracks settle:{" "}
              {overall.blocked_by.map((key) => trackName(key, trackNames)).join(", ")}.
            </p>
          ) : null}
          {rating.updated_at === null ? null : <p className="text-xs text-muted">Updated {formatShortDate(rating.updated_at)}</p>}
        </div>
      )}
      {footer}
    </ProgressCard>
  );
}
