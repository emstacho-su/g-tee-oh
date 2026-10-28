/**
 * R3.16 the typed reason's one rule (S41, O-412, PR #39 review finding 3 and security LOW 1): the
 * probe cases a blank-looking reason is made of, shared by the api boundary and the web's Submit.
 * Exported as RATIONALE_PROBES so the api and web tests run the very same cases.
 */
import { describe, expect, it } from "vitest";

import { RATIONALE_MAX_CHARS, RATIONALE_MIN_CHARS, cleanRationale, rationaleReady, visibleRationaleChars } from "../src/index.js";

/** [why, raw reason, accepted] */
const PROBES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["three letters", "abc", true],
  ["two letters", "ab", false],
  ["two letters spaced out", "  a  b  ", false],
  ["Hangul filler U+3164", "ㅤㅤㅤ", false],
  ["halfwidth Hangul filler U+FFA0", "ﾠﾠﾠ", false],
  ["blank braille pattern U+2800", "⠀⠀⠀", false],
  ["combining grapheme joiner U+034F", "͏͏͏", false],
  ["variation selectors around two letters", "a️️b︎", false],
  ["bare combining marks", "́́́", false],
  ["zero-width spaces around two letters", "​a​b​", false],
  ["control characters around two letters", "\u0007a\u0000b\u001F", false],
  ["three digits", "123", true],
  ["three punctuation marks", "?!.", true],
  ["three CJK letters", "日本語", true],
  ["a decomposed accent counts once", "éé", false],
  ["at the raw bound", "x".repeat(RATIONALE_MAX_CHARS), true],
  ["over the raw bound", "x".repeat(RATIONALE_MAX_CHARS + 1), false],
];

describe("R3.16 the typed reason's rule", () => {
  it("R3.16 the bounds are 3 visible characters and 1,000 raw characters (O-412)", () => {
    expect([RATIONALE_MIN_CHARS, RATIONALE_MAX_CHARS]).toEqual([3, 1000]);
  });

  it.each(PROBES)("R3.16 %s", (_why, raw, accepted) => {
    expect(rationaleReady(raw)).toBe(accepted);
  });

  it("R3.16 cleaning normalises, drops invisible characters and collapses spacing", () => {
    expect(cleanRationale("  Calls\u0000here​ because\n\n the\tprice  ")).toBe("Calls here because the price");
    expect(cleanRationale("é")).toBe("é");
    expect(cleanRationale("aㅤb️")).toBe("ab");
    expect(visibleRationaleChars("a b, c")).toBe(4);
  });
});
