/**
 * The automated loop's pick stream (R4.10, R3.6, O-249, A1 section 2): the RandomSource learning's
 * pickNext draws from, a pure function of the session seed and the pick number, so a seed replays
 * the same class picks whatever the hands dealt.
 *
 * Mechanism: a SplitMix64 stream separate from the per-hand draws (sessions/randomness.ts), seeded
 * with the session seed XOR PICK_STREAM_SALT; pick k takes the stream's draw k as a unit draw.
 * pickNext draws at most once per pick, and a hypercorrection pick draws nothing, so each pick has
 * its own draw and the pick counter (state.learning.pick_no) is all the state the stream needs.
 */
import { createSplitMix64, type RandomSource } from "@g-tee-oh/learning";

import { fromHex64 } from "../sessions/randomness.js";

/** Separates the pick stream from the hand stream of the same seed ("PICKSTR1" in ASCII). */
export const PICK_STREAM_SALT = 0x5049434b53545231n;

/** The RandomSource of pick `pickNo` (0 first) of the session seeded with `seed`. */
export function pickRandomSource(seed: string, pickNo: number): RandomSource {
  if (!Number.isInteger(pickNo) || pickNo < 0) {
    throw new RangeError(`pick number ${pickNo} must be a non-negative integer`);
  }
  const generator = createSplitMix64(fromHex64(seed) ^ PICK_STREAM_SALT);
  for (let skipped = 0; skipped < pickNo; skipped += 1) {
    generator.nextU64();
  }
  return generator.nextUnit;
}
