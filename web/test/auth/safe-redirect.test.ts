/**
 * Safe redirect tests (R3.13, A9 section 3). The login page's redirect search value is attacker
 * controlled, so only a same-origin path starting with exactly one "/" survives; every other
 * shape, including percent-encoded and whitespace tricks, falls back to "/" (no open redirect).
 */
import { describe, expect, it } from "vitest";

import { safeRedirect, SAFE_REDIRECT_FALLBACK } from "../../src/auth/index.js";

const REJECTED: readonly unknown[] = [
  undefined,
  null,
  42,
  {},
  "",
  "study",
  "//evil.example",
  "//",
  "/\\evil.example",
  "\\\\evil.example",
  "\\/evil.example",
  "https://evil.example",
  "http://localhost/study",
  "HTTPS://evil.example",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "mailto:a@example.com",
  "ftp://evil.example",
  "/%2Fevil.example",
  "/%2fevil.example",
  "%2F%2Fevil.example",
  "/%5Cevil.example",
  "/%5cevil.example",
  "/%252Fevil.example",
  "/%25252Fevil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r/evil.example",
  "/\u0000x",
  "/\u007fx",
  " /study",
  "/study ",
  "/ /evil.example",
  "/ /evil.example",
  "/　/evil.example",
  "/ /evil.example",
  "/%09/evil.example",
  "/%0A/evil.example",
  "/%00",
  "/%",
  "/%zz",
  `/${"a".repeat(3000)}`,
];

const ACCEPTED: readonly string[] = ["/", "/study", "/drills/abc/run?x=1", "/drills/new#top", "/progress?range=30d&x=a%20b"];

describe("safeRedirect", () => {
  it("R3.13 the fallback is the home path", () => {
    expect(SAFE_REDIRECT_FALLBACK).toBe("/");
  });

  it.each(REJECTED.map((value) => [JSON.stringify(value) ?? String(value), value]))(
    "R3.13 rejects %s",
    (_label, value) => {
      expect(safeRedirect(value)).toBe("/");
    },
  );

  it.each(ACCEPTED.map((value) => [value]))("R3.13 accepts %s", (value) => {
    expect(safeRedirect(value)).toBe(value);
  });
});
