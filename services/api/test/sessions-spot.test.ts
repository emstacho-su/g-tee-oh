/**
 * The drill's spot as a session reads it (R3.6, 05 section 4, ADR 0004, O-249): hand classes, the
 * hands filter (all, a manual list, close decisions read from solver-query's row), the hero spot a
 * hand picks with and without alternate_seats, and the per-attempt draws of a hand dealt again.
 */
import { describe, expect, it } from "vitest";

import { canonicalClass, comboClass } from "../src/sessions/hand-class.js";
import { attemptDraws, handDraws } from "../src/sessions/randomness.js";
import {
  CLOSE_LOSS_MAX_PCT_POT,
  CLOSE_MIX_MIN_FREQUENCY,
  comboMayPass,
  isCloseRow,
  pickSpot,
  rowPasses,
  type HandsFilter,
  type SessionSpot,
} from "../src/sessions/spot.js";
import type { HeroSpot } from "../src/sessions/state.js";

const ROW = { hand: "AKo", ev_bb: [0, 1], ev_best_bb: 1, mixed: false };

describe("R3.6 hand classes", () => {
  it("R3.6 a combo names its class, high rank first, and a written class is made canonical", () => {
    expect(comboClass("AhKd")).toBe("AKo");
    expect(comboClass("KhAh")).toBe("AKs");
    expect(comboClass("QsQc")).toBe("QQ");
    expect(comboClass("7c2d")).toBe("72o");
    expect(canonicalClass("KAs")).toBe("AKs");
    expect(canonicalClass("TT")).toBe("TT");
    expect(() => comboClass("Ah")).toThrow();
  });
});

describe("R3.6 the hands filter", () => {
  it("R3.6 all keeps every hand; a manual list keeps its classes in any rank order", () => {
    expect(rowPasses({ mode: "all" }, { ...ROW, strategy: [1, 0], loss_pct_pot: [0, 9] })).toBe(true);
    const manual: HandsFilter = { mode: "manual", hands: ["KAo", "QQ"] };
    expect(rowPasses(manual, { ...ROW, strategy: [1, 0], loss_pct_pot: [0, 9] })).toBe(true);
    expect(rowPasses(manual, { ...ROW, hand: "72o", strategy: [1, 0], loss_pct_pot: [0, 9] })).toBe(false);
    expect(comboMayPass(manual, "AhKd")).toBe(true);
    expect(comboMayPass(manual, "7c2d")).toBe(false);
    expect(comboMayPass({ mode: "close_decisions" }, "7c2d")).toBe(true);
  });

  it("R3.6 close decisions are rows solver-query mixes, or rows with a second action under the loss threshold", () => {
    const mixed = { ...ROW, strategy: [1 - CLOSE_MIX_MIN_FREQUENCY, CLOSE_MIX_MIN_FREQUENCY], loss_pct_pot: [0, 30] };
    const cheap = { ...ROW, strategy: [1, 0], loss_pct_pot: [0, CLOSE_LOSS_MAX_PCT_POT] };
    const pure = { ...ROW, strategy: [1, 0], loss_pct_pot: [0, CLOSE_LOSS_MAX_PCT_POT + 1] };
    expect(isCloseRow(mixed)).toBe(true);
    expect(isCloseRow(cheap)).toBe(true);
    expect(isCloseRow(pure)).toBe(false);
    expect(rowPasses({ mode: "close_decisions" }, pure)).toBe(false);
  });
});

describe("R3.6 the hero spot a hand picks", () => {
  const btnOpens: HeroSpot = { config_id: "cfg_6_online_100", pair: "BB-BTN", line: null, hero_seat: "BTN", history: [] };
  const bbFacesOpen: HeroSpot = {
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    line: "r250",
    hero_seat: "BB",
    history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
  };
  const otherPair: HeroSpot = { config_id: "cfg_6_online_100", pair: "CO-BTN", line: null, hero_seat: "CO", history: [] };
  const spots = [btnOpens, bbFacesOpen, otherPair];
  const alternate: SessionSpot = { preflop_action: ["rfi", "vs_open"], hands: { mode: "all" }, alternate_seats: true };

  it("R3.6 alternate_seats alternates the pair's hero seats hand by hand, out of position first", () => {
    const seats = [0, 1, 2, 3].map((handNo) => pickSpot(spots, alternate, handNo, 0n).hero_seat);
    expect(seats).toEqual(["BB", "BTN", "BB", "BTN"]);
  });

  it("R3.6 the draw picks the pair first, then a spot of it; without alternate_seats any of the pair's spots", () => {
    expect(pickSpot(spots, alternate, 0, 1n)).toEqual(otherPair);
    const free = { ...alternate, alternate_seats: false };
    const picked = [0n, 2n, 4n, 6n].map((pick) => pickSpot(spots, free, 0, pick).hero_seat);
    expect(new Set(picked)).toEqual(new Set(["BTN", "BB"]));
    expect(() => pickSpot([], free, 0, 0n)).toThrow();
  });
});

describe("R3.6 deal attempts", () => {
  it("R3.6 attempt 0 is the hand's own draws; later attempts derive new, repeatable draws", () => {
    const base = handDraws("00000000deadbeef", 3);
    expect(attemptDraws(base, 0)).toEqual(base);
    const first = attemptDraws(base, 1);
    expect(first).toEqual(attemptDraws(base, 1));
    expect(first.dealSeed).not.toBe(base.dealSeed);
    expect(attemptDraws(base, 2).dealSeed).not.toBe(first.dealSeed);
    expect(() => attemptDraws(base, -1)).toThrow(RangeError);
  });
});
