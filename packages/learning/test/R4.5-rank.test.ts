/**
 * R4.5 overall rank and tiers (S30; 06 sections 3.4 and 3.5, ADR 0011, O-8, O-56, O-252). The
 * overall rating is the weighted mean of the tracks' conservative ratings (rating minus two RD),
 * each track weighted by its frequency prior per 1,000 hands times its average pot factor. The
 * band tier comes from the overall rating with lower edges inclusive; the tier shown is the highest
 * tier at or below the band such that it is tier I or every track has RD under 120 and a
 * conservative rating at or above that tier's floor, so farming one track cannot promote.
 * Fixtures are synthetic.
 */
import { describe, expect, it } from "vitest";

import {
  PROMOTION_RD_CAP,
  TIER_FLOORS,
  bandTier,
  overallRating,
  tierFor,
  trackWeight,
} from "../src/rank.js";
import type { Tier, TrackStanding } from "../src/rank.js";

function standing(trackKey: string, rating: number, rd: number, weight: number): TrackStanding {
  return { trackKey, rating: { rating, rd, volatility: 0.06 }, weight };
}

/** A rank fixture as the plan names it: tracks, the overall computed by hand, the tier expected. */
type RankFixture = Readonly<{ tracks: readonly TrackStanding[]; expectedOverall: number; expectedTier: Tier }>;

/**
 * Three synthetic tracks:
 *   open-raise:  weight 12 x 1.5 = 18,   rating 1700 RD 60,  conservative 1580
 *   vs-3bet:     weight 5.25 x 2 = 10.5, rating 1600 RD 80,  conservative 1440
 *   squeeze:     weight 2 x 0.75 = 1.5,  rating 1550 RD 100, conservative 1350
 * overall = (18 x 1580 + 10.5 x 1440 + 1.5 x 1350) / (18 + 10.5 + 1.5)
 *         = (28440 + 15120 + 2025) / 30 = 45585 / 30 = 1519.5, band III (floor 1450).
 * Every RD is under 120, but vs-3bet (1440) and squeeze (1350) sit under the III floor, so the
 * tier is II (floor 1300, which every track clears) and blockedBy names those two.
 */
const WEIGHTED_FIXTURE: RankFixture = {
  tracks: [
    standing("open-raise", 1700, 60, trackWeight(12, 1.5)),
    standing("vs-3bet", 1600, 80, trackWeight(5.25, 2)),
    standing("squeeze", 1550, 100, trackWeight(2, 0.75)),
  ],
  expectedOverall: 1519.5,
  expectedTier: "II",
};

describe("R4.5 overall rating (06 section 3.4)", () => {
  it("R4.5 track weight is the frequency prior per 1,000 hands times the average pot factor", () => {
    expect(trackWeight(12, 1.5)).toBe(18);
    expect(trackWeight(5.25, 2)).toBe(10.5);
    expect(trackWeight(0, 3)).toBe(0);
  });

  it("R4.5 the overall rating is the weighted mean of conservative ratings, computed by hand for three tracks", () => {
    expect(overallRating(WEIGHTED_FIXTURE.tracks)).toBeCloseTo(WEIGHTED_FIXTURE.expectedOverall, 9);
    const result = tierFor(WEIGHTED_FIXTURE.tracks);
    expect(result.overall).toBeCloseTo(WEIGHTED_FIXTURE.expectedOverall, 9);
    expect(result.bandTier).toBe("III");
    expect(result.tier).toBe(WEIGHTED_FIXTURE.expectedTier);
    expect(result.blockedBy).toEqual(["vs-3bet", "squeeze"]);
  });

  it("R4.5 a zero-weight track does not move the overall rating", () => {
    const withIdle = [...WEIGHTED_FIXTURE.tracks, standing("idle", 900, 350, 0)];
    expect(overallRating(withIdle)).toBeCloseTo(WEIGHTED_FIXTURE.expectedOverall, 9);
  });
});

describe("R4.5 tier bands (06 section 3.5, O-8 placeholder names, lower edge inclusive)", () => {
  it("R4.5 the floors are I open below, then 1300 to 2200 in steps of 150, and the RD cap is 120", () => {
    expect(TIER_FLOORS).toEqual([
      { tier: "I", floor: Number.NEGATIVE_INFINITY },
      { tier: "II", floor: 1300 },
      { tier: "III", floor: 1450 },
      { tier: "IV", floor: 1600 },
      { tier: "V", floor: 1750 },
      { tier: "VI", floor: 1900 },
      { tier: "VII", floor: 2050 },
      { tier: "VIII", floor: 2200 },
    ]);
    expect(PROMOTION_RD_CAP).toBe(120);
  });

  const edges: [number, Tier][] = [
    [-400, "I"],
    [1299.99, "I"],
    [1300, "II"],
    [1449.99, "II"],
    [1450, "III"],
    [1600, "IV"],
    [1750, "V"],
    [1900, "VI"],
    [2050, "VII"],
    [2199.99, "VII"],
    [2200, "VIII"],
    [3100, "VIII"],
  ];
  it.each(edges)("R4.5 an overall of %s is in band %s", (overall, tier) => {
    expect(bandTier(overall)).toBe(tier);
  });
});

describe("R4.5 promotion needs coverage (O-252)", () => {
  it("R4.5 farming one track (2400, RD 50) with another track at RD 350 stays at tier I and blockedBy names the uncovered track", () => {
    const tracks = [standing("farmed", 2400, 50, 1), standing("untouched", 1500, 350, 1)];
    // conservative 2300 and 800, overall 1550, band III
    const result = tierFor(tracks);
    expect(result.overall).toBeCloseTo(1550, 9);
    expect(result.bandTier).toBe("III");
    expect(result.tier).toBe("I");
    expect(result.blockedBy).toEqual(["untouched"]);
  });

  it("R4.5 every RD under 120 and every conservative rating at or above the floor promotes to the band tier", () => {
    const tracks = [standing("a", 2150, 100, 3), standing("b", 2110, 80, 2), standing("c", 2130, 115, 1)];
    // conservative 1950, 1950, 1900; overall (5850 + 3900 + 1900) / 6 = 1941.67, band VI (1900)
    const result = tierFor(tracks);
    expect(result.overall).toBeCloseTo(11650 / 6, 9);
    expect(result).toMatchObject({ bandTier: "VI", tier: "VI", blockedBy: [] });
  });

  it("R4.5 RD exactly 120 blocks promotion and RD just under it does not", () => {
    const atCap = [standing("a", 1800, PROMOTION_RD_CAP, 1), standing("b", 1800, PROMOTION_RD_CAP, 1)];
    // conservative 1560 each, band III; RD 120 is not under the cap, so even II is blocked
    expect(tierFor(atCap)).toMatchObject({ bandTier: "III", tier: "I", blockedBy: ["a", "b"] });
    const underCap = [standing("a", 1800, 119.99, 1), standing("b", 1800, 119.99, 1)];
    expect(tierFor(underCap)).toMatchObject({ bandTier: "III", tier: "III", blockedBy: [] });
  });

  it("R4.5 a band of I is tier I with nothing blocking, whatever the RDs", () => {
    expect(tierFor([standing("new", 1500, 350, 1)])).toEqual({
      overall: 800,
      bandTier: "I",
      tier: "I",
      blockedBy: [],
    });
  });

  it("R4.5 tierFor does not mutate its tracks", () => {
    const tracks = Object.freeze(WEIGHTED_FIXTURE.tracks.map((track) => Object.freeze({ ...track })));
    const before = structuredClone(tracks);
    tierFor(tracks);
    expect(tracks).toEqual(before);
  });
});

describe("R4.5 input checks (RangeError naming the field)", () => {
  it("R4.5 an empty track list, a non-positive total weight and a negative weight are RangeErrors", () => {
    expect(() => overallRating([])).toThrow(/tracks/);
    expect(() => tierFor([])).toThrow(/tracks/);
    expect(() => overallRating([standing("a", 1500, 100, 0)])).toThrow(/weight/);
    expect(() => overallRating([standing("a", 1500, 100, -1), standing("b", 1500, 100, 3)])).toThrow(
      /tracks\[0\]\.weight/,
    );
    expect(() => overallRating([standing("a", 1500, 100, Number.NaN)])).toThrow(/tracks\[0\]\.weight/);
  });

  it("R4.5 a malformed track key, a duplicate key and a malformed rating are RangeErrors", () => {
    expect(() => overallRating([standing("", 1500, 100, 1)])).toThrow(/trackKey/);
    expect(() => overallRating([standing(7 as unknown as string, 1500, 100, 1)])).toThrow(/trackKey/);
    expect(() => overallRating([standing("a", 1500, 100, 1), standing("a", 1600, 100, 1)])).toThrow(/duplicate/);
    expect(() => overallRating([standing("a", 1500, -5, 1)])).toThrow(/rd/);
    expect(() => overallRating(null as unknown as TrackStanding[])).toThrow(/tracks/);
  });

  it("R4.5 invalid track weight inputs and a non-finite overall are RangeErrors", () => {
    expect(() => trackWeight(-1, 1)).toThrow(/freqPriorPer1000/);
    expect(() => trackWeight(1, Number.NaN)).toThrow(/avgPotFactor/);
    expect(() => bandTier(Number.NaN)).toThrow(/overall/);
    expect(() => bandTier(Number.POSITIVE_INFINITY)).toThrow(/overall/);
  });
});
