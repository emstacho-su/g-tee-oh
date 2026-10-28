/**
 * The progress aggregations (R4.12, O-271, O-252, O-275), pure, over a synthetic fixture
 * (test/fixtures/progress-attempts.json) with hand-computed expectations: the top 10 weekly leak
 * series, the heat map cells, the effective track weights and the overall rating card with its tier
 * and blockers.
 */
import { readFileSync } from "node:fs";

import type { TrackRating } from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import type { TrackKey } from "../src/learning/tracks.js";
import { heatmapOf, type ClassMemory, type HeatmapClass } from "../src/progress/heatmap.js";
import { leakTrend, leakWeeks, type LeakClassInfo, type LeakHistoryEntry, type LeakStatRow } from "../src/progress/leaks.js";
import { overallRatingOf } from "../src/progress/rating.js";
import { effectiveTrackWeights } from "../src/progress/weights.js";
import { TRACK_KEYS } from "../src/learning/tracks.js";

interface Fixture {
  today: string;
  weeks: number;
  leakStats: LeakStatRow[];
  leakHistory: LeakHistoryEntry[];
  leakClassInfo: Record<string, LeakClassInfo>;
  expectedLeaks: { weeks: string[]; order: string[]; series: Record<string, (number | null)[]> };
  heatmapClasses: HeatmapClass[];
  memory: Record<string, ClassMemory>;
  expectedHeatmap: unknown;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/progress-attempts.json", import.meta.url), "utf8")) as Fixture;
const ALL_ENABLED = new Map(TRACK_KEYS.map((key) => [key, 1]));
const VOLATILITY = 0.06;

function rating(value: number, rd: number): TrackRating {
  return { rating: value, rd, volatility: VOLATILITY };
}

describe("R4.12 leak trend", () => {
  const weeks = leakWeeks(fixture.today, fixture.weeks);
  const trend = leakTrend(fixture.leakStats, fixture.leakHistory, weeks, (key) => fixture.leakClassInfo[key]);

  it("R4.12 the weeks are Mondays, oldest first, ending with the current week", () => {
    expect(trend.weeks).toEqual(fixture.expectedLeaks.weeks);
  });

  it("R4.12 the top 10 by current leak cost skip classes the catalog no longer lists and break ties by key", () => {
    expect(trend.items.map((item) => item.spot_class_key)).toEqual(fixture.expectedLeaks.order);
  });

  it("R4.12 each series reads leak_history for past weeks and the live leak cost for the partial week", () => {
    for (const item of trend.items) {
      const expected = fixture.expectedLeaks.series[item.spot_class_key];
      expect(item.series.map((point) => point.leak_cost_bb_per_1k), item.spot_class_key).toEqual(expected);
      expect(item.series.map((point) => point.partial)).toEqual([false, false, true]);
      expect(item.family).toBe(fixture.leakClassInfo[item.spot_class_key]?.family);
    }
  });
});

describe("R4.12 heat map", () => {
  it("R4.12 rows by family and pair, columns by format and depth, cells with mastery and retrievability", () => {
    expect(heatmapOf(fixture.heatmapClasses, (key) => fixture.memory[key])).toEqual(fixture.expectedHeatmap);
  });
});

describe("R4.12 effective track weights and the overall rating", () => {
  const classes = [
    { trackKey: "opens" as const, frequencyPriorPer1k: 10, meanPotBb: 2.5 },
    { trackKey: "opens" as const, frequencyPriorPer1k: 30, meanPotBb: 2.5 },
    { trackKey: "blind-defense" as const, frequencyPriorPer1k: 20, meanPotBb: 5 },
    { trackKey: null, frequencyPriorPer1k: 99, meanPotBb: 9 },
  ];

  it("R4.12 prior times mean pot per track, normalized; uncovered tracks weigh 0", () => {
    const weights = effectiveTrackWeights(classes, ALL_ENABLED);
    expect(weights.get("opens")).toBeCloseTo(0.5);
    expect(weights.get("blind-defense")).toBeCloseTo(0.5);
    expect(weights.get("facing-3bet")).toBe(0);
    const disabled = effectiveTrackWeights(classes, new Map([...ALL_ENABLED, ["opens", 0]]));
    expect(disabled.get("blind-defense")).toBeCloseTo(1);
  });

  it("R4.12 no rating row means no card", () => {
    expect(overallRatingOf(new Map(), effectiveTrackWeights(classes, ALL_ENABLED))).toBeNull();
  });

  it("R4.12 the weighted conservative rating gives the band tier when no track blocks", () => {
    const weights = effectiveTrackWeights(classes, ALL_ENABLED);
    const ratings = new Map<TrackKey, TrackRating>([["opens", rating(1700, 50)], ["blind-defense", rating(1600, 60)]]);
    expect(overallRatingOf(ratings, weights)).toEqual({
      mu: 1650,
      rd: 55,
      conservative: 1540,
      tier: "III",
      band_tier: "III",
      blocked_by: [],
    });
  });

  it("R4.12 a covered track with a deviation at the cap holds the tier at I and is named", () => {
    const weights = effectiveTrackWeights(classes, ALL_ENABLED);
    const ratings = new Map<TrackKey, TrackRating>([["opens", rating(1700, 50)], ["blind-defense", rating(1600, 130)]]);
    expect(overallRatingOf(ratings, weights)).toMatchObject({ conservative: 1470, tier: "I", band_tier: "III", blocked_by: ["blind-defense"] });
  });

  it("R4.12 a covered track never rated stands at the defaults and blocks promotion", () => {
    const weights = effectiveTrackWeights(classes, ALL_ENABLED);
    const ratings = new Map<TrackKey, TrackRating>([["opens", rating(2400, 40)]]);
    const card = overallRatingOf(ratings, weights);
    // opens 2400 - 80 = 2320; blind-defense 1500 - 700 = 800; mean 1560.
    expect(card).toMatchObject({ conservative: 1560, band_tier: "III", tier: "I", blocked_by: ["blind-defense"] });
  });

  it("R4.12 with nothing covered the rated tracks count equally", () => {
    const ratings = new Map<TrackKey, TrackRating>([["opens", rating(1700, 50)], ["facing-3bet", rating(1500, 50)]]);
    expect(overallRatingOf(ratings, effectiveTrackWeights([], ALL_ENABLED))).toMatchObject({ mu: 1600, conservative: 1500 });
  });
});
