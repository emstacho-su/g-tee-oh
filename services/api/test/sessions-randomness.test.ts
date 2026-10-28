/**
 * Session randomness (R3.6, O-249, O-151, O-152): the session seed, the per-hand draws and the hero
 * RNG roll derive from SplitMix64 deterministically, so a session replays from its seed.
 */
import { createSplitMix64 } from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import { HEX64_PATTERN } from "../src/schemas/training.js";
import {
  DRAWS_PER_HAND,
  drawRoll,
  fromHex64,
  handDraws,
  newSessionSeed,
  pickIndex,
  toHex64,
} from "../src/sessions/randomness.js";

const SEED = "00000000deadbeef";

describe("R3.6 session randomness", () => {
  it("R3.6 a new session seed is 64 random bits as Hex64", () => {
    const seeds = new Set(Array.from({ length: 8 }, () => newSessionSeed()));
    for (const seed of seeds) {
      expect(seed).toMatch(HEX64_PATTERN);
    }
    expect(seeds.size).toBe(8);
  });

  it("R3.6 Hex64 round-trips and pads to sixteen digits", () => {
    expect(toHex64(0xffn)).toBe("00000000000000ff");
    expect(fromHex64("00000000000000ff")).toBe(0xffn);
    expect(toHex64(fromHex64(SEED))).toBe(SEED);
    expect(() => fromHex64("xyz")).toThrow(RangeError);
  });

  it("R3.6 hand draws are a pure function of the seed and the hand number", () => {
    expect(handDraws(SEED, 3)).toEqual(handDraws(SEED, 3));
    expect(handDraws(SEED, 3)).not.toEqual(handDraws(SEED, 4));
    expect(handDraws(SEED, 0)).not.toEqual(handDraws("00000000deadbef0", 0));
  });

  it("R3.6 hand n takes SplitMix64 draws n * DRAWS_PER_HAND onward from the session seed", () => {
    const generator = createSplitMix64(fromHex64(SEED));
    const values = Array.from({ length: DRAWS_PER_HAND * 2 }, () => generator.nextU64());
    const second = handDraws(SEED, 1);
    expect(second.dealSeed).toBe(toHex64(values[DRAWS_PER_HAND] ?? -1n));
    expect(second.pick).toBe(values[DRAWS_PER_HAND + 1]);
    expect(second.opponentRngState).toBe(toHex64(values[DRAWS_PER_HAND + 2] ?? -1n));
    expect(second.rollRngState).toBe(toHex64(values[DRAWS_PER_HAND + 3] ?? -1n));
  });

  it("R3.6 pickIndex maps a draw onto the candidates", () => {
    expect(pickIndex(7n, 3)).toBe(1);
    expect(pickIndex(0n, 1)).toBe(0);
    expect(() => pickIndex(1n, 0)).toThrow(RangeError);
  });

  it("R3.6 drawRoll is a 1 to 100 roll and the next generator state, deterministically", () => {
    const first = drawRoll(SEED);
    expect(first).toEqual(drawRoll(SEED));
    expect(first.roll).toBeGreaterThanOrEqual(1);
    expect(first.roll).toBeLessThanOrEqual(100);
    expect(first.state).toMatch(HEX64_PATTERN);
    expect(first.state).not.toBe(SEED);
    const rolls = new Set(Array.from({ length: 50 }, (_, index) => drawRoll(toHex64(BigInt(index))).roll));
    expect(rolls.size).toBeGreaterThan(10);
  });
});
