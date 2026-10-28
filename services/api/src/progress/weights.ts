/**
 * Effective track weights (R4.12, O-271, 06 section 3.4), pure: how much each track counts in the
 * overall rating and which tracks can block a tier.
 *
 * Mechanism: per track, the summed frequency prior of its covered catalog classes (spots per 1,000
 * hands) and the prior-weighted mean start-node pot in big blinds go through learning's trackWeight,
 * times track.weight (the enable multiplier, 1 in v1); the results are normalized to sum to 1 over
 * the tracks that have a covered class. A track with no covered class in scope has weight 0, so it
 * neither counts nor blocks a tier (O-252). Every number comes from the catalog (solver-query, ADR
 * 0004) and learning's formula; nothing here is poker logic.
 */
import { trackWeight } from "@g-tee-oh/learning";

import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";

/** What a class contributes to its track's weight. */
export interface WeightedClass {
  trackKey: TrackKey | null;
  frequencyPriorPer1k: number;
  meanPotBb: number;
}

export type TrackWeights = ReadonlyMap<TrackKey, number>;

interface TrackTotals {
  prior: number;
  potTimesPrior: number;
}

function totalsByTrack(classes: readonly WeightedClass[]): ReadonlyMap<TrackKey, TrackTotals> {
  const totals = new Map<TrackKey, TrackTotals>();
  for (const cls of classes) {
    if (cls.trackKey === null) {
      continue;
    }
    const current = totals.get(cls.trackKey) ?? { prior: 0, potTimesPrior: 0 };
    totals.set(cls.trackKey, {
      prior: current.prior + cls.frequencyPriorPer1k,
      potTimesPrior: current.potTimesPrior + cls.frequencyPriorPer1k * cls.meanPotBb,
    });
  }
  return totals;
}

/**
 * Every track's normalized effective weight (0 to 1, summing to 1 when any track is covered).
 * `enabled` is track.weight by key; a track missing from it counts as disabled (0).
 */
export function effectiveTrackWeights(classes: readonly WeightedClass[], enabled: ReadonlyMap<TrackKey, number>): TrackWeights {
  const totals = totalsByTrack(classes);
  const raw = TRACK_KEYS.map((key) => {
    const total = totals.get(key);
    if (total === undefined || total.prior <= 0) {
      return [key, 0] as const;
    }
    const meanPot = total.potTimesPrior / total.prior;
    return [key, (enabled.get(key) ?? 0) * trackWeight(total.prior, meanPot)] as const;
  });
  const sum = raw.reduce((accumulated, [, weight]) => accumulated + weight, 0);
  return new Map(raw.map(([key, weight]) => [key, sum > 0 ? weight / sum : 0]));
}
