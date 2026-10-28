/**
 * The overall rating card (R4.12, R4.14, O-271, O-252, ADR 0011, 06 sections 3.4 and 3.5), pure:
 * the weighted rating, its deviation band and the tier, recomputed on every read and at every
 * session end, never stored (O-252).
 *
 * Mechanism: each track's rating arrives with inactivity already applied (Lane B's ratingOnRead,
 * O-251); a covered track the user has never rated stands at learning's newTrackRating, so its wide
 * deviation blocks promotion until it is played (06 section 3.4). learning's tierFor ranks the
 * weighted conservative rating and names the blocking tracks; mu and rd are the same weighted means
 * of the tracks' ratings and deviations. With no rating row at all the card is null. When the
 * catalog gives no track a weight (nothing covered in scope), the rated tracks count equally, so a
 * user with ratings is never shown nothing.
 */
import { newTrackRating, tierFor, type Tier, type TrackRating, type TrackStanding } from "@g-tee-oh/learning";

import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import type { TrackWeights } from "./weights.js";

export interface OverallRating {
  mu: number;
  rd: number;
  conservative: number;
  tier: Tier;
  band_tier: Tier;
  blocked_by: TrackKey[];
}

function weightsOrEqual(ratings: ReadonlyMap<TrackKey, TrackRating>, weights: TrackWeights): TrackWeights {
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (total > 0) {
    return weights;
  }
  return new Map([...ratings.keys()].map((key) => [key, 1 / ratings.size]));
}

/** The standings tierFor ranks: every track with a weight or a rating. */
export function trackStandings(ratings: ReadonlyMap<TrackKey, TrackRating>, weights: TrackWeights): TrackStanding[] {
  const used = weightsOrEqual(ratings, weights);
  return TRACK_KEYS.filter((key) => (used.get(key) ?? 0) > 0 || ratings.has(key)).map((key) => ({
    trackKey: key,
    rating: ratings.get(key) ?? newTrackRating(),
    weight: used.get(key) ?? 0,
  }));
}

function weightedMean(standings: readonly TrackStanding[], value: (rating: TrackRating) => number): number {
  const total = standings.reduce((sum, standing) => sum + standing.weight, 0);
  return standings.reduce((sum, standing) => sum + standing.weight * value(standing.rating), 0) / total;
}

function asTrackKeys(keys: readonly string[]): TrackKey[] {
  return keys.flatMap((key) => TRACK_KEYS.filter((candidate) => candidate === key));
}

/** The overall rating card, or null before any rated session. */
export function overallRatingOf(ratings: ReadonlyMap<TrackKey, TrackRating>, weights: TrackWeights): OverallRating | null {
  if (ratings.size === 0) {
    return null;
  }
  const standings = trackStandings(ratings, weights);
  const result = tierFor(standings);
  return {
    mu: weightedMean(standings, (rating) => rating.rating),
    rd: weightedMean(standings, (rating) => rating.rd),
    conservative: result.overall,
    tier: result.tier,
    band_tier: result.bandTier,
    blocked_by: asTrackKeys(result.blockedBy),
  };
}
