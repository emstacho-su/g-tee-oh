/**
 * R3.10 seeded generator vectors (S22). The chi-square runs draw their rolls from a SplitMix64
 * RandomSource, the generator solver-query uses for deals and sample-action (O-151,
 * services/solver-query/src/rng.rs). Every number below was printed by the Rust generator itself:
 * on 2026-10-27 a temporary test inside rng.rs's test module (not committed) printed next_u64,
 * next_unit and the matching 1 to 100 roll, and `cargo test -p solver-query --lib rng::` ran it
 * green beside the existing reference-vector tests. The seed 1234567 outputs equal rng.rs's
 * REFERENCE_OUTPUTS; seed 20261020 is the chi-square seed of O-90. Equality here proves the
 * TypeScript port draws bit for bit what Rust draws, so a session seed replays the same rolls on
 * either side.
 */
import { describe, expect, it } from "vitest";

import { createSplitMix64, rollFrom, splitMix64Source, splitMix64Step } from "../src/index.js";

/** rng.rs REFERENCE_SEED and REFERENCE_OUTPUTS (Vigna's splitmix64.c for seed 1234567). */
export const RUST_REFERENCE_SEED = 1_234_567n;
export const RUST_REFERENCE_OUTPUTS: readonly bigint[] = Object.freeze([
  6_457_827_717_110_365_317n,
  3_203_168_211_198_807_973n,
  9_817_491_932_198_370_423n,
  4_593_380_528_125_082_431n,
  16_408_922_859_458_223_821n,
  7_804_594_928_223_864_054n,
]);

/** Rust's first six draws at the chi-square seed: next_u64, next_unit and floor(100 x unit) + 1. */
export const RUST_CHI_SQUARE_SEED = 20_261_020n;
export const RUST_CHI_SQUARE_DRAWS: readonly { u64: bigint; unit: number; roll: number }[] = Object.freeze([
  { u64: 6_136_304_632_546_739_453n, unit: 0.3326497406820019, roll: 34 },
  { u64: 3_026_303_308_496_171_157n, unit: 0.16405623108358092, roll: 17 },
  { u64: 11_229_912_580_826_674_755n, unit: 0.6087747808477288, roll: 61 },
  { u64: 17_413_288_923_158_423_295n, unit: 0.9439762840303065, roll: 95 },
  { u64: 5_449_940_633_683_987_580n, unit: 0.29544187374786024, roll: 30 },
  { u64: 12_281_072_908_373_935_737n, unit: 0.6657582963855946, roll: 67 },
]);

/** Rust's first draw from the largest seed, which wraps the state on the first step. */
export const RUST_MAX_SEED = 18_446_744_073_709_551_615n;
export const RUST_MAX_SEED_FIRST = Object.freeze({ u64: 16_490_336_266_968_443_936n, unit: 0.8939429202831845 });

const GOLDEN_GAMMA = 0x9e37_79b9_7f4a_7c15n;

describe("R3.10 SplitMix64 RandomSource equals the Rust generator (O-151, O-90)", () => {
  it("R3.10 SplitMix64 reproduces rng.rs's reference outputs for seed 1234567", () => {
    const generator = createSplitMix64(RUST_REFERENCE_SEED);
    expect(RUST_REFERENCE_OUTPUTS.map(() => generator.nextU64())).toEqual(RUST_REFERENCE_OUTPUTS);
  });

  it("R3.10 SplitMix64 draws Rust's units and rolls at the chi-square seed 20261020", () => {
    const words = createSplitMix64(RUST_CHI_SQUARE_SEED);
    const units = splitMix64Source(RUST_CHI_SQUARE_SEED);
    const rolls = splitMix64Source(RUST_CHI_SQUARE_SEED);
    for (const draw of RUST_CHI_SQUARE_DRAWS) {
      expect(words.nextU64()).toBe(draw.u64);
      expect(units()).toBe(draw.unit);
      expect(rollFrom(rolls)).toBe(draw.roll);
    }
  });

  it("R3.10 SplitMix64 wraps the 64-bit state like Rust's wrapping_add at the largest seed", () => {
    const generator = createSplitMix64(RUST_MAX_SEED);
    expect(generator.nextU64()).toBe(RUST_MAX_SEED_FIRST.u64);
    expect(splitMix64Source(RUST_MAX_SEED)()).toBe(RUST_MAX_SEED_FIRST.unit);
  });

  it("R3.10 splitMix64Step is pure: it returns the next state and output and the same state gives the same step", () => {
    const first = splitMix64Step(RUST_REFERENCE_SEED);
    expect(first).toEqual({ state: RUST_REFERENCE_SEED + GOLDEN_GAMMA, value: RUST_REFERENCE_OUTPUTS[0] });
    expect(splitMix64Step(RUST_REFERENCE_SEED)).toEqual(first);
    expect(splitMix64Step(first.state).value).toBe(RUST_REFERENCE_OUTPUTS[1]);
  });

  it("R3.10 SplitMix64 rejects a seed outside the unsigned 64-bit range", () => {
    expect(() => createSplitMix64(-1n)).toThrow(RangeError);
    expect(() => createSplitMix64(RUST_MAX_SEED + 1n)).toThrow(RangeError);
    expect(() => splitMix64Step(-1n)).toThrow(RangeError);
  });

  it("R3.10 every unit draw lies in [0, 1) over 10,000 draws from the largest seed", () => {
    const random = splitMix64Source(RUST_MAX_SEED);
    for (let draw = 0; draw < 10_000; draw += 1) {
      const unit = random();
      expect(unit >= 0 && unit < 1, `draw ${draw} was ${unit}`).toBe(true);
    }
  });
});
