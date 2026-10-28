/**
 * The Ask validator (R3.20, O-308, A6 section 5, 05 section 10.2, 01 criterion 9): every hand and
 * card name must be in the grounding, then every number must match a grounding value within half
 * a unit of its last shown digit, or 100 times one (a shown percentage of a share). No small
 * integer is exempt.
 */
import { describe, expect, it } from "vitest";

import { buildGrounding } from "../src/explain/grounding.js";
import { validateAnswer } from "../src/explain/validator.js";
import { SOURCES_55 } from "./support/explain-sources.js";

const bundle = buildGrounding(SOURCES_55);

function check(text: string) {
  return validateAnswer(text, bundle);
}

describe("R3.20 validator: numbers", () => {
  it("R3.20 a planted unsupported number is rejected (criterion 9)", () => {
    const result = check("Call is played 50.2% of the time and earns 7.31 bb.");
    expect(result.ok).toBe(false);
    expect(result.unsupportedNumbers).toEqual(["7.31 bb"]);
    expect(result.unsupportedNames).toEqual([]);
  });

  it("R3.20 supported numbers pass at the precision shown", () => {
    const result = check("Folding loses 16.26% of the pot, 16.3% rounded; the call earns 0.65 bb and 0.650 bb.");
    expect(result).toEqual({ ok: true, unsupportedNumbers: [], unsupportedNames: [] });
  });

  it("R3.20 a shown percentage of a share passes, a wrong digit does not", () => {
    expect(check("The range folds 77.2% and raises 13.1%.").ok).toBe(true);
    expect(check("The range folds 77.3%.").unsupportedNumbers).toEqual(["77.3%"]);
  });

  it("R3.20 the tolerance is half a unit of the last shown digit", () => {
    expect(check("Call 50.20%.").ok).toBe(true);
    expect(check("Call 50.25%.").ok).toBe(false);
    expect(check("Call 50%.").ok).toBe(true);
  });

  it("R3.20 signs and the unicode minus are read", () => {
    expect(check("The acting seat is -10.6 points behind.").ok).toBe(true);
    expect(check("The acting seat is −10.6 points behind.").ok).toBe(true);
    expect(check("The acting seat is +10.6 points ahead.").ok).toBe(false);
  });

  it("R3.20 no small integer is exempt", () => {
    expect(check("There are 7 reasons.").unsupportedNumbers).toEqual(["7"]);
  });

  it("R3.20 thousands separators are not read as a supported number", () => {
    expect(check("The range holds 1,326 combos.").unsupportedNumbers).toEqual(["1,326"]);
  });

  it("R3.20 numbers inside hand names and action labels are not read as numbers", () => {
    expect(check("A5s and K5s are blocked; KTs takes Raise to 10bb.").ok).toBe(true);
    expect(check("Raise to 12bb.").unsupportedNumbers).toEqual(["12bb"]);
  });

  it("R3.20 a sentence-ending period does not change the number", () => {
    expect(check("It removes 21.").ok).toBe(true);
  });
});

describe("R3.20 validator: names", () => {
  it("R3.20 hand classes and cards in the grounding pass", () => {
    expect(check("5h5d is 55; it blocks A5o, A5s and K5o. The 5h matters.").ok).toBe(true);
  });

  it("R3.20 a hand class absent from the grounding is rejected", () => {
    const result = check("Compare it with T9s.");
    expect(result.ok).toBe(false);
    expect(result.unsupportedNames).toEqual(["T9s"]);
  });

  it("R3.20 a pair class absent from the grounding is rejected, and is not read as a number", () => {
    const result = check("Compare it with 99.");
    expect(result.unsupportedNames).toEqual(["99"]);
    expect(result.unsupportedNumbers).toEqual([]);
  });

  it("R3.20 a card absent from the grounding is rejected", () => {
    expect(check("The Ac is a blocker.").unsupportedNames).toEqual(["Ac"]);
  });

  it("R3.20 a combo absent from the grounding is rejected", () => {
    expect(check("With AhKd it would raise.").unsupportedNames).toEqual(["AhKd"]);
  });

  it("R3.20 a sentence-opening As or Ah is a word, not a card", () => {
    expect(check("As the big blind, call. Ah, the raise is close.").ok).toBe(true);
    expect(check("Holding As changes it.").unsupportedNames).toEqual(["As"]);
  });

  it("R3.20 a class written without its suit letter passes when a class of those ranks is present", () => {
    expect(check("A5 hands are blocked.").ok).toBe(true);
    expect(check("QJ hands are not.").unsupportedNames).toEqual(["QJ"]);
  });

  it("R3.20 each unsupported value is listed once", () => {
    expect(check("T9s, T9s, 7 and 7.").unsupportedNames).toEqual(["T9s"]);
    expect(check("T9s, T9s, 7 and 7.").unsupportedNumbers).toEqual(["7"]);
  });
});
