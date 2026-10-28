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

describe("R3.20 validator: numbers the digit reader used to miss (PR #29 review M7)", () => {
  it("R3.20 a leading-dot decimal is read: .35 is caught, .65 bb passes", () => {
    expect(check("Call earns .35 of the pot.").unsupportedNumbers).toEqual([".35"]);
    expect(check("Call earns .65 bb.").ok).toBe(true);
  });

  it("R3.20 a number right after a letter is read: x7 is caught", () => {
    expect(check("Raise x7 the pot.").unsupportedNumbers).toEqual(["7"]);
  });

  it("R3.20 EV1.8bb is caught when 1.8 is not grounded and EV0.65bb passes when it is", () => {
    expect(check("The call has EV1.8bb.").unsupportedNumbers).toEqual(["1.8bb"]);
    expect(check("The call has EV0.65bb.").ok).toBe(true);
  });

  it("R3.20 full-width digits are read after NFKC: a planted one is caught, a grounded one passes", () => {
    expect(check("There are ７ reasons.").unsupportedNumbers).toEqual(["7"]);
    expect(check("It removes ２１ combos.").ok).toBe(true);
  });

  it("R3.20 other decimal digits (Arabic-Indic) are read and never pass", () => {
    expect(check("There are ٧ reasons.").unsupportedNumbers).toEqual(["٧"]);
    expect(check("It removes ٢١ combos.").unsupportedNumbers).toEqual(["٢١"]);
  });

  it("R3.20 a hyphen between two numbers is not read as a sign", () => {
    expect(check("It removes 21-1000 combos.").ok).toBe(true);
  });
});

describe("R3.20 validator: spelled-out numbers (PR #29 review M7)", () => {
  it("R3.20 cardinal words are flagged as unvalidated numbers", () => {
    expect(check("There are three reasons.").unsupportedNumbers).toEqual(["three"]);
    expect(check("Zero, eleven, twenty and a hundred.").unsupportedNumbers).toEqual(["Zero", "eleven", "twenty", "hundred"]);
  });

  it("R3.20 a compound number and a percent phrase are flagged as one value", () => {
    expect(check("It removes twenty-one combos.").unsupportedNumbers).toEqual(["twenty-one"]);
    expect(check("Call seventy percent and fold one hundred and five per cent.").unsupportedNumbers).toEqual([
      "seventy percent",
      "one hundred and five per cent",
    ]);
  });

  it("R3.20 a spelled-out number in full-width letters is flagged after NFKC", () => {
    expect(check("There are ｔｈｒｅｅ reasons.").unsupportedNumbers).toEqual(["three"]);
  });

  it("R3.20 ordinals, bet-level words, hand categories and words holding a number word pass", () => {
    const text =
      "First, a three-bet or four-bet changes it; second, two pair and three of a kind are strong, ten-high is not. " +
      "Someone often weighs the tension between them, and at least half the time it folds.";
    expect(check(text)).toEqual({ ok: true, unsupportedNumbers: [], unsupportedNames: [] });
  });

  it("R3.20 a number word inside a grounding label passes", () => {
    const labelled = { ...bundle, labels: [...bundle.labels, "Bet one third pot"] };
    expect(validateAnswer("Bet one third pot is close.", labelled).ok).toBe(true);
    expect(validateAnswer("Bet one third pot is one option.", labelled).unsupportedNumbers).toEqual(["one"]);
  });
});

describe("R3.20 validator: worded hand and card names (PR #29 review M7)", () => {
  it("R3.20 pocket and pair-of names pass only when the pair is grounded", () => {
    expect(check("Pocket fives and a pair of fives are the same hand.").ok).toBe(true);
    const result = check("Pocket aces would raise; a pair of kings too.");
    expect(result.unsupportedNames).toEqual(["Pocket aces", "pair of kings"]);
    expect(result.unsupportedNumbers).toEqual([]);
  });

  it("R3.20 two-rank names pass only when the class they name is grounded", () => {
    expect(check("Ace five suited, king five offsuit, ace-five and five ace suited are blocked.").ok).toBe(true);
    const result = check("Ace king suited, queen jack offsuit and ten-nine are not.");
    expect(result.unsupportedNames).toEqual(["Ace king suited", "queen jack offsuit", "ten-nine"]);
    expect(result.unsupportedNumbers).toEqual([]);
  });

  it("R3.20 nicknames name a class and are flagged unless it is grounded", () => {
    expect(check("Big slick, pocket rockets and cowboys raise.").unsupportedNames).toEqual([
      "Big slick",
      "pocket rockets",
      "cowboys",
    ]);
  });

  it("R3.20 worded cards pass only when the card is grounded", () => {
    expect(check("The five of hearts matters.").ok).toBe(true);
    expect(check("The ace of clubs is a blocker.").unsupportedNames).toEqual(["ace of clubs"]);
  });
});
