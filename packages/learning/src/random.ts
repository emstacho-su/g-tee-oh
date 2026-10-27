/**
 * SplitMix64, the seeded generator behind the package's injected RandomSource (S22, R3.10).
 *
 * Mechanism: the same algorithm as solver-query's generator (services/solver-query/src/rng.rs,
 * O-151, after Vigna's public-domain splitmix64.c): the 64-bit state advances by the golden gamma
 * each draw, the output is the advanced state through the two-multiply finalizer, and a unit draw
 * is the top 53 bits over 2^53, exact in a double and strictly under 1. BigInt arithmetic masked
 * to 64 bits reproduces Rust's wrapping operations, so a seed draws bit for bit the same numbers on
 * both sides (test/R3.10-splitmix64.test.ts pins vectors printed by the Rust code). The step is a
 * pure function of the state; the RandomSource wrapper keeps the state in a closure because the
 * RandomSource type is a stateful draw by definition (A1 section 2).
 */
import type { RandomSource } from "./types.js";

const U64_BITS = 64n;
const U64_MASK = (1n << U64_BITS) - 1n;

/** The state increment per draw: the golden ratio in 64 bits. */
const GOLDEN_GAMMA = 0x9e37_79b9_7f4a_7c15n;

/** The finalizer's two multipliers and three xor-shift distances. */
const MIX_1 = 0xbf58_476d_1ce4_e5b9n;
const MIX_2 = 0x94d0_49bb_1331_11ebn;
const SHIFT_1 = 30n;
const SHIFT_2 = 27n;
const SHIFT_3 = 31n;

/** High bits of a draw that make a unit float, and 2^53 as its denominator. */
const UNIT_BITS = 53n;
const UNIT_DENOMINATOR = 2 ** Number(UNIT_BITS);

/** One step of the generator: the next state and the 64-bit output it draws. */
export type SplitMix64Step = { state: bigint; value: bigint };

/** A seeded generator: 64-bit draws and unit draws in [0, 1) from one shared state. */
export type SplitMix64 = { nextU64: () => bigint; nextUnit: () => number };

function requireU64(value: bigint, field: string): bigint {
  if (value < 0n || value > U64_MASK) {
    throw new RangeError(`${field} must be an unsigned 64-bit integer, got ${value}`);
  }
  return value;
}

/** The pure step: advance the state by the golden gamma and finalize it into the output. */
export function splitMix64Step(state: bigint): SplitMix64Step {
  const next = (requireU64(state, "state") + GOLDEN_GAMMA) & U64_MASK;
  const z1 = ((next ^ (next >> SHIFT_1)) * MIX_1) & U64_MASK;
  const z2 = ((z1 ^ (z1 >> SHIFT_2)) * MIX_2) & U64_MASK;
  return { state: next, value: z2 ^ (z2 >> SHIFT_3) };
}

/** The top 53 bits of a 64-bit draw over 2^53. */
function unitOf(value: bigint): number {
  return Number(value >> (U64_BITS - UNIT_BITS)) / UNIT_DENOMINATOR;
}

/** A generator seeded like Rust's SplitMix64::new(seed); a RangeError for a seed outside 0 to 2^64 - 1. */
export function createSplitMix64(seed: bigint): SplitMix64 {
  let state = requireU64(seed, "seed");
  const nextU64 = (): bigint => {
    const step = splitMix64Step(state);
    state = step.state;
    return step.value;
  };
  return Object.freeze({ nextU64, nextUnit: () => unitOf(nextU64()) });
}

/** The RandomSource of a seed: each call is Rust's next_unit for the same seed and draw. */
export function splitMix64Source(seed: bigint): RandomSource {
  return createSplitMix64(seed).nextUnit;
}
