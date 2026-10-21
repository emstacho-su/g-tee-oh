// Node dump corpus agreement (R2.8, criterion 2): the TypeScript checker accepts exactly the dumps
// in validation/fixtures/node-dump/cases.json marked accept, so it agrees with the Rust checker in
// tools/library-pack, whose test r2_8_rust_checker_agrees_with_corpus reads the same index. The
// corpus README describes the index; this file reads it from disk at test time, so a new case
// needs no change here.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkNodeDumpInvariants } from "../src/index.js";

/** One row of cases.json. */
interface CorpusCase {
  readonly file: string;
  readonly accept: boolean;
  readonly rules: readonly number[];
}

const CORPUS_DIR = new URL("../../../validation/fixtures/node-dump/", import.meta.url);

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, CORPUS_DIR), "utf8")) as unknown;
}

function isCorpusCase(value: unknown): value is CorpusCase {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Readonly<Record<string, unknown>>;
  const typed = typeof row.file === "string" && typeof row.accept === "boolean";
  return typed && Array.isArray(row.rules);
}

/** The cases of the index; a malformed index fails the suite instead of passing it empty. */
function corpusCases(): readonly CorpusCase[] {
  const index = readJson("cases.json");
  const isObject = typeof index === "object" && index !== null;
  const cases = isObject ? (index as { cases?: unknown }).cases : undefined;
  if (!Array.isArray(cases) || cases.length === 0 || !cases.every(isCorpusCase)) {
    throw new Error("validation/fixtures/node-dump/cases.json has no well-formed cases");
  }
  return cases;
}

/** The criterion 2 rules of node-dump.ts, each of which the corpus must exercise. */
const RULE_NUMBERS = [1, 2, 3, 4, 5] as const;

describe("R2.8 the TypeScript checker agrees with the corpus", () => {
  for (const corpusCase of corpusCases()) {
    it(`R2.8 ${corpusCase.file} is ${corpusCase.accept ? "accepted" : "rejected"}`, () => {
      const violations = checkNodeDumpInvariants(readJson(corpusCase.file));
      expect(violations.length === 0).toBe(corpusCase.accept);
    });
  }

  it("R2.8 the corpus rejects a dump for each of rules 1 to 5 and marks accepts rule-free", () => {
    const cases = corpusCases();
    const broken = new Set(cases.flatMap((corpusCase) => corpusCase.rules));
    expect([...broken].sort((a, b) => a - b)).toEqual([...RULE_NUMBERS]);
    for (const corpusCase of cases) {
      expect(corpusCase.rules.length === 0).toBe(corpusCase.accept);
    }
  });
});
