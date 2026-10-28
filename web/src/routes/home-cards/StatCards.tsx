/**
 * The home streak and rating cards (S32, R4.12, R4.14, 06 sections 7 and 8, A7 section 2): the
 * foundation's StreakBadge and RatingCard tiles over the streak, rating and tracks reads, each
 * with loading, error (Try again) and data states.
 *
 * The streak tile names cosmetics through the catalog (describeCosmetic). The rating card links to
 * /progress, names held-back tracks from the tracks read when it has arrived (the card falls back
 * to keys while it loads), and shows the equipped badge as a pill when the server has unlocked it
 * (useEffectiveCosmetics, O-323). Cosmetics never change what the cards report (ADR 0012).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { useAppApi } from "../../auth/index.js";
import { BadgePill } from "../../cosmetics/BadgePill.js";
import { describeCosmetic } from "../../cosmetics/catalog.js";
import { useEffectiveCosmetics } from "../../cosmetics/CosmeticsRoot.js";
import { ProgressCard, RatingCard, StreakBadge } from "../../components/progress/index.js";
import { LoadingNote } from "../../components/ui/index.js";
import { ratingQuery, streakQuery, tracksQuery } from "../../progress/queries.js";
import type { TrackKey } from "../../progress/types.js";
import { LoadError } from "./LoadError.js";

export const OPEN_PROGRESS = "Open progress";

export function HomeStreakCard() {
  const streak = useQuery(streakQuery(useAppApi()));
  if (streak.data !== undefined) return <StreakBadge streak={streak.data} describeCosmetic={describeCosmetic} />;
  return (
    <ProgressCard title="Streak" testId="streak-badge">
      {streak.isError ? (
        <LoadError message="The streak could not be loaded." retries="the streak" onRetry={() => void streak.refetch()} />
      ) : (
        <LoadingNote text="Loading the streak." />
      )}
    </ProgressCard>
  );
}

export function HomeRatingCard() {
  const api = useAppApi();
  const rating = useQuery(ratingQuery(api));
  const tracks = useQuery(tracksQuery(api));
  const badge = useEffectiveCosmetics().badge;
  // Until the tracks read arrives the map is empty and the card names tracks by key.
  const trackNames = useMemo(
    (): Partial<Record<TrackKey, string>> => Object.fromEntries((tracks.data ?? []).map((track) => [track.track_key, track.name])),
    [tracks.data],
  );
  if (rating.data !== undefined) {
    return (
      <RatingCard
        rating={rating.data}
        trackNames={trackNames}
        badge={badge === null ? undefined : <BadgePill cosmeticKey={badge} />}
        footer={
          <Link to="/progress" className="text-sm underline">
            {OPEN_PROGRESS}
          </Link>
        }
      />
    );
  }
  return (
    <ProgressCard title="Rating" testId="rating-card">
      {rating.isError ? (
        <LoadError message="The rating could not be loaded." retries="the rating" onRetry={() => void rating.refetch()} />
      ) : (
        <LoadingNote text="Loading the rating." />
      )}
    </ProgressCard>
  );
}
