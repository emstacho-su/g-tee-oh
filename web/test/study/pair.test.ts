/**
 * Tests for the one pair split the study code shares (S45 follow-up, R3.12, code review 3): a pair
 * names the out-of-position seat first, so its two positions read as oop and ip; anything that is
 * not two parts joined by one dash reads as none. The matrix's acting-seat index, the
 * advantage card's seats and the settings panel's seats all go through it.
 */
import { describe, expect, it } from "vitest";

import { actingSeatIndex } from "../../src/components/range-matrix/model.js";
import { spotLineKey } from "../../src/study/saved-spots.js";
import { parsePair } from "../../src/poker/pair.js";
import { draftFromSearch } from "../../src/study/settings.js";

describe("R3.12 one pair split", () => {
  it("R3.12 parsePair reads oop then ip and refuses anything that is not two parts", () => {
    expect(parsePair("BB-BTN")).toEqual(["BB", "BTN"]);
    expect(parsePair("SB-BB")).toEqual(["SB", "BB"]);
    expect(parsePair("BB")).toBeNull();
    expect(parsePair("BB-BTN-CO")).toBeNull();
    expect(parsePair(undefined)).toBeNull();
  });

  it("R3.12 the matrix, the settings panel and the saved spots agree on it", () => {
    expect(actingSeatIndex({ pair: "BB-BTN", to_act: "BTN" })).toBe(1);
    expect(draftFromSearch({ pair: "BB-BTN" })).toEqual({ first: "BTN", against: "BB" });
    expect(spotLineKey({ format: "online", pair: "BB-BTN", line: "r250" })).toBe(spotLineKey({ format: "online", pair: "BB-BTN", line: "r250", mode: "ev" }));
    expect(spotLineKey({ pair: "BB-BTN", line: "r250" })).not.toBe(spotLineKey({ pair: "BB-BTN" }));
  });
});
