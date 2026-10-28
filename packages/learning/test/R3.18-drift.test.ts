/**
 * R3.18 range drift vectors (S27, O-304). Drift compares the user's action-kind shares in one node
 * family with the solver's frequencies on the same decisions: total variation distance with a
 * percentile bootstrap interval, hidden below 30 decisions. The hand-computed set below has three
 * decisions at a fold, call, raise node:
 *
 *   d1 freqs 0, 0.5, 0.5, chose call; d2 freqs 1, 0, 0, chose fold; d3 freqs 0, 0, 1, chose call.
 *   user: fold 1/3, call 2/3, raise 0. solver: fold 1/3, call 1/6, raise 1/2.
 *   distance = (0 + 1/2 + 1/2) / 2 = 1/2.
 */
import { describe, expect, it } from "vitest";

import {
  DRIFT_BOOTSTRAP_RESAMPLES,
  DRIFT_BOOTSTRAP_SEED,
  DRIFT_CONFIDENCE,
  DRIFT_MIN_DECISIONS,
  driftKindShares,
  rangeDrift,
  totalVariationDistance,
  type DriftDecision,
} from "../src/drift.js";

const FOLD_CALL_RAISE = Object.freeze(["fold", "call", "raise"] as const);

function decision(chosenKind: DriftDecision["chosenKind"], freqByAction: readonly number[]): DriftDecision {
  return { chosenKind, kinds: FOLD_CALL_RAISE, freqByAction };
}

const HAND_SET: readonly DriftDecision[] = [
  decision("call", [0, 0.5, 0.5]),
  decision("fold", [1, 0, 0]),
  decision("call", [0, 0, 1]),
];

function repeated(rows: readonly DriftDecision[], times: number): readonly DriftDecision[] {
  return Array.from({ length: times }, () => rows).flat();
}

/** Thirty-three decisions mixing the hand set with ten pure spots the user matches. */
const MIXED_SET: readonly DriftDecision[] = [...repeated(HAND_SET, 8), ...repeated([decision("raise", [0, 0, 1])], 9)];

describe("R3.18 drift constants (O-304)", () => {
  it("R3.18 pins the minimum, confidence, resamples and a 64-bit seed", () => {
    expect(DRIFT_MIN_DECISIONS).toBe(30);
    expect(DRIFT_CONFIDENCE).toBe(0.95);
    expect(DRIFT_BOOTSTRAP_RESAMPLES).toBe(1000);
    expect(typeof DRIFT_BOOTSTRAP_SEED).toBe("bigint");
    expect(DRIFT_BOOTSTRAP_SEED >= 0n && DRIFT_BOOTSTRAP_SEED < 1n << 64n).toBe(true);
  });
});

describe("R3.18 kind shares and distance", () => {
  it("R3.18 computes the hand-checked shares and a distance of one half", () => {
    const shares = driftKindShares(HAND_SET);
    expect(shares.map((share) => share.kind)).toEqual(["fold", "call", "raise"]);
    expect(shares[0]?.userShare).toBeCloseTo(1 / 3, 12);
    expect(shares[1]?.userShare).toBeCloseTo(2 / 3, 12);
    expect(shares[2]?.userShare).toBe(0);
    expect(shares[0]?.solverShare).toBeCloseTo(1 / 3, 12);
    expect(shares[1]?.solverShare).toBeCloseTo(1 / 6, 12);
    expect(shares[2]?.solverShare).toBeCloseTo(1 / 2, 12);
    expect(totalVariationDistance(shares)).toBeCloseTo(0.5, 12);
  });

  it("R3.18 sums the frequencies of every action of one kind (two raise sizes)", () => {
    const shares = driftKindShares([{ chosenKind: "raise", kinds: ["fold", "raise", "raise"], freqByAction: [0.2, 0.3, 0.5] }]);
    expect(shares).toEqual([
      { kind: "fold", userShare: 0, solverShare: 0.2 },
      { kind: "raise", userShare: 1, solverShare: 0.8 },
    ]);
  });

  it("R3.18 lists only kinds that appear, in the fixed kind order", () => {
    const shares = driftKindShares([
      { chosenKind: "bet", kinds: ["bet", "check"], freqByAction: [0.4, 0.6] },
      { chosenKind: "all_in", kinds: ["all_in", "fold", "call"], freqByAction: [0.1, 0.5, 0.4] },
    ]);
    expect(shares.map((share) => share.kind)).toEqual(["fold", "check", "call", "bet", "all_in"]);
  });

  it("R3.18 an empty list has no shares and a zero distance", () => {
    expect(driftKindShares([])).toEqual([]);
    expect(totalVariationDistance([])).toBe(0);
  });
});

describe("R3.18 rangeDrift visibility", () => {
  it("R3.18 hides drift at 29 decisions with no numbers", () => {
    const result = rangeDrift(repeated([decision("call", [0, 1, 0])], 29));
    expect(result).toEqual({ shown: false, decisions: 29 });
  });

  it("R3.18 shows drift at 30 decisions", () => {
    const result = rangeDrift(repeated(HAND_SET, 10));
    expect(result.shown).toBe(true);
    if (!result.shown) {
      return;
    }
    expect(result.decisions).toBe(30);
    expect(result.confidence).toBe(DRIFT_CONFIDENCE);
    expect(result.distance).toBeCloseTo(0.5, 12);
    expect(result.byKind.map((share) => share.kind)).toEqual(["fold", "call", "raise"]);
  });

  it("R3.18 identical choices to the solver's argmax on pure spots give distance 0 and a zero interval", () => {
    const pure = [decision("fold", [1, 0, 0]), decision("call", [0, 1, 0]), decision("raise", [0, 0, 1])];
    const result = rangeDrift(repeated(pure, 10));
    expect(result).toMatchObject({ shown: true, distance: 0, ciLow: 0, ciHigh: 0 });
  });
});

describe("R3.18 bootstrap interval", () => {
  it("R3.18 the interval contains the point estimate and stays within 0 and 1", () => {
    const result = rangeDrift(MIXED_SET);
    if (!result.shown) {
      throw new Error("expected a shown drift");
    }
    expect(result.ciLow).toBeLessThanOrEqual(result.distance);
    expect(result.ciHigh).toBeGreaterThanOrEqual(result.distance);
    expect(result.ciLow).toBeGreaterThanOrEqual(0);
    expect(result.ciHigh).toBeLessThanOrEqual(1);
    expect(result.ciHigh).toBeGreaterThan(result.ciLow);
  });

  it("R3.18 the interval is deterministic: the fixed seed gives the same numbers every call", () => {
    expect(rangeDrift(MIXED_SET)).toEqual(rangeDrift(MIXED_SET));
  });

  it("R3.18 reordering the decisions keeps the point estimate", () => {
    const reversed = [...MIXED_SET].reverse();
    const forward = rangeDrift(MIXED_SET);
    const backward = rangeDrift(reversed);
    if (!forward.shown || !backward.shown) {
      throw new Error("expected shown drifts");
    }
    expect(backward.distance).toBeCloseTo(forward.distance, 12);
  });
});

describe("R3.18 input checks", () => {
  it("R3.18 rows with mismatched kinds and frequencies throw", () => {
    expect(() => rangeDrift([{ chosenKind: "fold", kinds: ["fold", "call"], freqByAction: [1] }])).toThrow(RangeError);
  });

  it("R3.18 a chosen kind outside the row's kinds throws", () => {
    expect(() => driftKindShares([{ chosenKind: "raise", kinds: ["fold", "call"], freqByAction: [0.5, 0.5] }])).toThrow(RangeError);
  });

  it("R3.18 unknown kinds and negative or non-finite frequencies throw", () => {
    const unknownKind = { chosenKind: "fold", kinds: ["fold", "jam"], freqByAction: [0.5, 0.5] } as unknown as DriftDecision;
    expect(() => driftKindShares([unknownKind])).toThrow(RangeError);
    expect(() => driftKindShares([decision("fold", [1, -0.1, 0])])).toThrow(RangeError);
    expect(() => driftKindShares([decision("fold", [1, Number.NaN, 0])])).toThrow(RangeError);
  });

  it("R3.18 a non-list input throws", () => {
    expect(() => rangeDrift("rows" as unknown as readonly DriftDecision[])).toThrow(RangeError);
    const badRow = { chosenKind: "fold", kinds: "fold", freqByAction: [1] } as unknown as DriftDecision;
    expect(() => driftKindShares([badRow])).toThrow(RangeError);
  });
});
