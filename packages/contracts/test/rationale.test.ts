/**
 * R3.16 the typed reason's one rule (S41, O-412, PR #39 review finding 3 and security LOW 1): the
 * probe cases a blank-looking reason is made of, shared by the api boundary and the web's Submit.
 * Exported as RATIONALE_PROBES so the api and web tests run the very same cases.
 */
import { describe, expect, it } from "vitest";

import { RATIONALE_MAX_CHARS, RATIONALE_MIN_CHARS, checkRationale, cleanRationale, rationaleReady, visibleRationaleChars } from "../src/index.js";

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
  // PR #39 re-review MEDIUM: U+FB2C is one UTF-16 unit but three code points after NFC, so 1,000 of
  // them pass the raw bound and would overflow the database's 1,000 character check.
  ["NFC lengthens past the bound (U+FB2C x 1,000)", "\uFB2C".repeat(RATIONALE_MAX_CHARS), false],
  ["NFC lengthens but stays within the bound (U+FB2C x 333)", "\uFB2C".repeat(333), true],
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

  // PR #41 review round 1, finding 9: the probe is written as an escape, so a tool that normalises
  // source text cannot quietly turn it into its three-code-point form and defuse the test.
  it("R3.16 the U+FB2C probe is still the one-unit form NFC lengthens", () => {
    expect("שּׁ".length).toBe(1);
    expect([..."שּׁ".normalize("NFC")]).toHaveLength(3);
  });
});

describe("R3.16 checkRationale cleans once and judges the cleaned text (PR #41 review round 1, findings 7 and 8)", () => {
  it("R3.16 returns the cleaned text the api stores with the verdict", () => {
    expect(checkRationale("  a​b\u0000c  ")).toEqual({ cleaned: "ab c", length: 4, visible: 3, tooLong: false, ready: true });
    expect(checkRationale("ab")).toMatchObject({ cleaned: "ab", ready: false, tooLong: false });
  });

  it("R3.16 counts the cleaned text by code point and names a reason NFC pushes past the bound", () => {
    const check = checkRationale("שּׁ".repeat(RATIONALE_MAX_CHARS));
    expect(check.length).toBe(3 * RATIONALE_MAX_CHARS);
    expect(check.tooLong).toBe(true);
    expect(check.ready).toBe(false);
  });

  it.each(PROBES)("R3.16 %s: rationaleReady is checkRationale's verdict", (_why, raw) => {
    expect(rationaleReady(raw)).toBe(checkRationale(raw).ready);
    expect(visibleRationaleChars(raw)).toBe(checkRationale(raw).visible);
  });
});
