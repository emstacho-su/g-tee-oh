/**
 * Session randomness (R3.6, O-249, O-151, O-152, A6 section 2): a session replays identically from
 * its seed.
 *
 * Mechanism: the session seed is the Hex64 `seed` of POST /sessions or 64 random bits from
 * node:crypto. Every per-hand value derives from it with packages/learning's SplitMix64, the same
 * generator solver-query runs: hand n takes the DRAWS_PER_HAND draws starting at draw
 * n * DRAWS_PER_HAND, in this order: the deal seed (solver-query's deal is a pure function of the
 * seed and filter, O-152), the candidate pick, the opponent's starting generator state for
 * /v1/sample-action (which returns the next state, carried in the session state), and the hero's
 * RNG roll generator state. Hands are counted from 0 and a session plays at most hundreds, so
 * skipping to a hand's draws costs microseconds. A roll is the unit draw of the roll state through
 * learning's rollFrom, and the roll state advances by one SplitMix64 step per roll.
 */
import { randomBytes } from "node:crypto";

import { createSplitMix64, rollFrom, splitMix64Step } from "@g-tee-oh/learning";

import { HEX64_PATTERN } from "../schemas/training.js";

/** Draws each hand takes from the session stream: deal seed, pick, opponent state, roll state. */
export const DRAWS_PER_HAND = 4;
const SEED_BYTES = 8;
const HEX64_DIGITS = 16;
const HEX_RADIX = 16;

export interface HandDraws {
  dealSeed: string;
  pick: bigint;
  opponentRngState: string;
  rollRngState: string;
}

export interface RollDraw {
  roll: number;
  /** The roll generator's state after the draw. */
  state: string;
}

/** 64 random bits as Hex64, for a session created without a seed. */
export function newSessionSeed(): string {
  return randomBytes(SEED_BYTES).toString("hex");
}

export function toHex64(value: bigint): string {
  return value.toString(HEX_RADIX).padStart(HEX64_DIGITS, "0");
}

export function fromHex64(text: string): bigint {
  if (!HEX64_PATTERN.test(text)) {
    throw new RangeError(`${JSON.stringify(text)} is not sixteen lowercase hexadecimal digits`);
  }
  return BigInt(`0x${text}`);
}

/** The draws of hand `handNo` (0 first) of the session seeded with `seed`. */
export function handDraws(seed: string, handNo: number): HandDraws {
  if (!Number.isInteger(handNo) || handNo < 0) {
    throw new RangeError(`hand number ${handNo} must be a non-negative integer`);
  }
  const generator = createSplitMix64(fromHex64(seed));
  for (let skipped = 0; skipped < handNo * DRAWS_PER_HAND; skipped += 1) {
    generator.nextU64();
  }
  const dealSeed = toHex64(generator.nextU64());
  const pick = generator.nextU64();
  const opponentRngState = toHex64(generator.nextU64());
  const rollRngState = toHex64(generator.nextU64());
  return { dealSeed, pick, opponentRngState, rollRngState };
}

/** The candidate a 64-bit draw picks among `count`. */
export function pickIndex(draw: bigint, count: number): number {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`cannot pick among ${count} candidates`);
  }
  return Number(draw % BigInt(count));
}

/** The hero's 1 to 100 RNG roll from the roll generator state, and the state after it (05 section 7). */
export function drawRoll(state: string): RollDraw {
  const current = fromHex64(state);
  const unit = createSplitMix64(current).nextUnit();
  return { roll: rollFrom(() => unit), state: toHex64(splitMix64Step(current).state) };
}
