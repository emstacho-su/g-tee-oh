/**
 * Overall rank and tiers (A6 section 1 row "Overall rank, tiers"; 06 sections 3.4 and 3.5).
 * Owner: S30 (p4/learning), closing R4.5. Kept apart from src/glicko2.ts so the rating update and
 * the ranking policy each stay small.
 *
 * Mechanism: each track's weight is its frequency prior per 1,000 hands times its average pot
 * factor, so the spots that cost money most often count most; the overall rating is the weighted
 * mean of the tracks' conservative ratings (rating minus two RD, ADR 0011), the weights normalized
 * by their sum. The band tier is the highest tier whose floor is at or below the overall rating,
 * lower edges inclusive (06 section 3.5, O-56). The tier shown is recomputed from current state
 * every time, with no stored tier and no hysteresis (O-252): the highest tier at or below the band
 * such that it is tier I, or every track has RD under PROMOTION_RD_CAP and a conservative rating at
 * or above that tier's floor. Farming one track therefore cannot promote. Tier names are O-8
 * placeholders and the bands a first guess, recalibrated once holdout results exist.
 */
import { conservativeRating } from "./glicko2.js";
import type { TrackRating } from "./glicko2.js";
import { elementAt, isList, requireNonNegative } from "./validate.js";

/** Tier names (O-8 placeholders). */
export type Tier = "I" | "II" | "III" | "IV" | "V" | "VI" | "VII" | "VIII";

/** One tier and the lowest conservative overall rating in its band (inclusive). */
export type TierFloor = Readonly<{ tier: Tier; floor: number }>;

/** A track's key, Glicko-2 state and weight in the overall rating. */
export type TrackStanding = Readonly<{ trackKey: string; rating: TrackRating; weight: number }>;

/** The overall rating, its band, the tier shown and the tracks that blocked promotion to the band. */
export type TierResult = Readonly<{ overall: number; bandTier: Tier; tier: Tier; blockedBy: readonly string[] }>;

/** Band floors in ascending order (06 section 3.5, O-56); tier I is open below. */
export const TIER_FLOORS: readonly TierFloor[] = Object.freeze([
  Object.freeze({ tier: "I", floor: Number.NEGATIVE_INFINITY }),
  Object.freeze({ tier: "II", floor: 1300 }),
  Object.freeze({ tier: "III", floor: 1450 }),
  Object.freeze({ tier: "IV", floor: 1600 }),
  Object.freeze({ tier: "V", floor: 1750 }),
  Object.freeze({ tier: "VI", floor: 1900 }),
  Object.freeze({ tier: "VII", floor: 2050 }),
  Object.freeze({ tier: "VIII", floor: 2200 }),
] satisfies TierFloor[]);

/** Every track's RD must be strictly under this for promotion above tier I (06 section 3.4, O-56). */
export const PROMOTION_RD_CAP = 120;

/** The lowest tier, which needs no coverage. */
const BASE_TIER_INDEX = 0;

/** A track's weight: frequency prior per 1,000 hands times average pot factor (06 section 3.4). */
export function trackWeight(freqPriorPer1000: number, avgPotFactor: number): number {
  return requireNonNegative(freqPriorPer1000, "freqPriorPer1000") * requireNonNegative(avgPotFactor, "avgPotFactor");
}

function validateTracks(tracks: readonly TrackStanding[]): void {
  if (!isList(tracks) || tracks.length === 0) {
    throw new RangeError("tracks must list at least one track");
  }
  const seen = new Set<string>();
  tracks.forEach((track, index) => {
    if (typeof track.trackKey !== "string" || track.trackKey.length === 0) {
      throw new RangeError(`tracks[${index}].trackKey must be a non-empty string`);
    }
    if (seen.has(track.trackKey)) {
      throw new RangeError(`tracks[${index}].trackKey is a duplicate of ${track.trackKey}`);
    }
    seen.add(track.trackKey);
    requireNonNegative(track.weight, `tracks[${index}].weight`);
  });
  const totalWeight = tracks.reduce((sum, track) => sum + track.weight, 0);
  if (totalWeight <= 0) {
    throw new RangeError(`tracks must have a positive total weight, got ${totalWeight}`);
  }
}

function weightedMean(tracks: readonly TrackStanding[]): number {
  const totalWeight = tracks.reduce((sum, track) => sum + track.weight, 0);
  const weightedSum = tracks.reduce((sum, track) => sum + track.weight * conservativeRating(track.rating), 0);
  return weightedSum / totalWeight;
}

/**
 * The weighted mean of the tracks' conservative ratings (06 section 3.4). Throws a RangeError on
 * an empty list, an empty or duplicate track key, a negative or non-finite weight, a total weight
 * of 0, or a malformed rating.
 */
export function overallRating(tracks: readonly TrackStanding[]): number {
  validateTracks(tracks);
  return weightedMean(tracks);
}

function bandIndex(overall: number): number {
  return TIER_FLOORS.reduce((found, entry, index) => (entry.floor <= overall ? index : found), BASE_TIER_INDEX);
}

function tierAt(index: number): TierFloor {
  return elementAt(TIER_FLOORS, index, "TIER_FLOORS");
}

/** The tier whose band holds the overall rating, lower edges inclusive (06 section 3.5). */
export function bandTier(overall: number): Tier {
  if (!Number.isFinite(overall)) {
    throw new RangeError(`overall must be a finite number, got ${overall}`);
  }
  return tierAt(bandIndex(overall)).tier;
}

/** The tracks that keep the tier at index from being shown: RD at or above the cap, or under its floor. */
function blockersAt(tracks: readonly TrackStanding[], index: number): string[] {
  if (index === BASE_TIER_INDEX) {
    return [];
  }
  const { floor } = tierAt(index);
  return tracks
    .filter((track) => track.rating.rd >= PROMOTION_RD_CAP || conservativeRating(track.rating) < floor)
    .map((track) => track.trackKey);
}

/**
 * The overall rating, its band tier, the tier shown and the tracks that blocked promotion to the
 * band tier (O-252). blockedBy is empty when the tier shown is the band tier.
 */
export function tierFor(tracks: readonly TrackStanding[]): TierResult {
  const overall = overallRating(tracks);
  const band = bandIndex(overall);
  let shown = band;
  while (blockersAt(tracks, shown).length > 0) {
    shown -= 1;
  }
  return Object.freeze({
    overall,
    bandTier: tierAt(band).tier,
    tier: tierAt(shown).tier,
    blockedBy: Object.freeze(blockersAt(tracks, band)),
  });
}
