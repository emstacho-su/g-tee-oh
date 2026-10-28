/**
 * The drill's preflop action vocabulary over solver-query's action families (R3.6, ADR 0004,
 * O-249, PR #25 re-review BLOCKER 1). The api never classifies a line itself: a node's family is
 * NodeResponse.action_family, gto-model's ActionFamily::classify, and the api only looks the drill
 * family up in one table. The table is pinned to classify's committed output
 * (validation/fixtures/action-family-vectors.json, the S21 seat-list pattern): every family the
 * vectors name is one the table knows, and each vector gets the verdict written out below.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { drillFamiliesFor, familyMatches, RUST_ACTION_FAMILIES } from "../src/sessions/action-family.js";

const VECTORS_PATH = fileURLToPath(new URL("../../../validation/fixtures/action-family-vectors.json", import.meta.url));

const vectorsSchema = z.object({
  source: z.string(),
  vectors: z.array(z.object({ pair: z.string(), line: z.string(), family: z.string() })).min(1),
});

/** The verdict each Rust family gets: the drill families it satisfies (the table restated, on purpose). */
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  rfi: ["rfi"],
  "facing-open": ["vs_open", "srp", "three_bet"],
  "facing-3bet": ["vs_three_bet", "four_bet"],
  "facing-4bet": ["four_bet"],
  squeeze: ["srp", "squeeze"],
  "limped-isolation": ["limp_iso"],
  "straddled-pot": ["straddle"],
  "blind-vs-blind": ["rfi", "vs_open", "srp", "three_bet", "vs_three_bet", "four_bet", "squeeze", "limp_iso", "straddle"],
};

const vectors = vectorsSchema.parse(JSON.parse(readFileSync(VECTORS_PATH, "utf8"))).vectors;

describe("R3.6 the drill family table is pinned to ActionFamily::classify", () => {
  it("R3.6 the table knows every family classify writes, and no other", () => {
    expect([...RUST_ACTION_FAMILIES].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const vector of vectors) {
      expect(RUST_ACTION_FAMILIES, `${vector.pair} ${vector.line}`).toContain(vector.family);
    }
  });

  for (const vector of vectors) {
    it(`R3.6 ${vector.pair} line "${vector.line}" (${vector.family}) satisfies the drill families of its family`, () => {
      expect(drillFamiliesFor(vector.family)).toEqual(EXPECTED[vector.family]);
    });
  }

  it("R3.6 where the old TypeScript parser disagreed with Rust, Rust wins: l.r400 is facing-open, so vs_open and not limp_iso", () => {
    const limpRaise = vectors.find((vector) => vector.pair === "BB-BTN" && vector.line === "l.r400");
    expect(limpRaise?.family).toBe("facing-open");
    expect(familyMatches(["limp_iso"], limpRaise?.family)).toBe(false);
    expect(familyMatches(["vs_open"], limpRaise?.family)).toBe(true);
  });

  it("R3.6 a postflop node (no family) or a family the table does not know matches no drill family", () => {
    expect(familyMatches(["rfi"], null)).toBe(false);
    expect(familyMatches(["rfi"], undefined)).toBe(false);
    expect(familyMatches(["rfi"], "a-family-from-the-future")).toBe(false);
  });
});
