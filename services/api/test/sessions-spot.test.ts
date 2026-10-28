/**
 * The drill's spot as a session reads it (R3.6, 05 section 4, ADR 0004, O-249): the preflop action
 * families mapped onto the line before the hero acts, hand classes, the hands filter (all, a
 * manual list, close decisions read from solver-query's row), the hero seats a hand may use with
 * and without alternate_seats, and the per-attempt draws of a hand dealt again.
 */
import { describe, expect, it } from "vitest";

import { familiesOf, lineTokens, matchesFamilies } from "../src/sessions/families.js";
import { canonicalClass, comboClass } from "../src/sessions/hand-class.js";
import { attemptDraws, handDraws } from "../src/sessions/randomness.js";
import {
  CLOSE_LOSS_MAX_PCT_POT,
  CLOSE_MIX_MIN_FREQUENCY,
  comboMayPass,
  heroSeatsFor,
  isCloseRow,
  rowPasses,
  type HandsFilter,
  type SessionSpot,
} from "../src/sessions/spot.js";
import type { Candidate } from "../src/sessions/state.js";

const ROW = { hand: "AKo", ev_bb: [0, 1], ev_best_bb: 1 };

describe("R3.6 preflop action families over the line before the hero acts", () => {
  it("R3.6 no raise is raise-first-in; a limp makes it limp/iso", () => {
    expect(familiesOf([])).toEqual(["rfi"]);
    expect(familiesOf(["l"])).toEqual(["limp_iso"]);
  });

  it("R3.6 one raise is vs open and a single-raised pot; a call after it is a squeeze", () => {
    expect(familiesOf(["r250"])).toEqual(["vs_open", "srp"]);
    expect(familiesOf(["r250", "c"])).toEqual(["srp", "squeeze"]);
    expect(familiesOf(["l", "r400"])).toEqual(["limp_iso"]);
  });

  it("R3.6 two raises are a 3-bet pot, vs 3-bet when the hero made the first raise; three or more are a 4-bet pot", () => {
    expect(familiesOf(["r250", "r1000"])).toEqual(["three_bet", "vs_three_bet"]);
    expect(familiesOf(["r250", "r1000", "r2200"])).toEqual(["four_bet"]);
    expect(familiesOf(["r250", "r1000", "a"])).toEqual(["four_bet"]);
  });

  it("R3.6 a straddle in the line is the straddle family only", () => {
    expect(familiesOf(["s200"])).toEqual(["straddle"]);
    expect(familiesOf(["s200", "r600"])).toEqual(["straddle"]);
  });

  it("R3.6 a drill matches when any of its families holds; the line's tokens come first", () => {
    expect(matchesFamilies(["rfi", "vs_open"], ["r250"])).toBe(true);
    expect(matchesFamilies(["squeeze"], ["r250"])).toBe(false);
    expect(lineTokens(null)).toEqual([]);
    expect(lineTokens("r250.c")).toEqual(["r250", "c"]);
  });
});

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

describe("R3.6 hero seats", () => {
  const both: Candidate = { config_id: "cfg_6_online_100", pair: "BB-BTN", hero_seats: ["BB", "BTN"] };
  const spot: SessionSpot = { preflop_action: ["rfi", "vs_open"], hands: { mode: "all" }, alternate_seats: true };

  it("R3.6 alternate_seats alternates the pair's playable seats hand by hand", () => {
    expect(heroSeatsFor(both, spot, 0)).toEqual(["BB"]);
    expect(heroSeatsFor(both, spot, 1)).toEqual(["BTN"]);
    expect(heroSeatsFor(both, spot, 2)).toEqual(["BB"]);
  });

  it("R3.6 without alternate_seats, or with one playable seat, every playable seat may be the hero", () => {
    expect(heroSeatsFor(both, { ...spot, alternate_seats: false }, 1)).toEqual(["BB", "BTN"]);
    expect(heroSeatsFor({ ...both, hero_seats: ["BB"] }, spot, 1)).toEqual(["BB"]);
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
