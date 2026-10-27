// Tests for scripts/lib/learning-purity.mjs (S30, R4.1 to R4.9, A1 section 2): packages/learning/src
// stays pure, with no I/O, no clock and no randomness except an injected RandomSource. node:test,
// run by `pnpm run test:scripts` (just ts-test).
//
// Mechanism: each planted snippet is linted with ESLint's Linter class against the purity block
// alone, parsed by the typescript-eslint parser without type information, so the test needs no
// file on disk. A second group checks that eslint.config.js applies the block to
// packages/learning/src only, which is what `just ts-lint` (pnpm -r lint) runs in CI.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Linter } from "eslint";
import tseslint from "typescript-eslint";

import config from "../../eslint.config.js";
import { LEARNING_PURITY_FILES, LEARNING_PURITY_RULES, learningPurityBlock } from "./learning-purity.mjs";

const PROBE_PATH = "packages/learning/src/probe.ts";

function lint(code) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: LEARNING_PURITY_RULES }],
    PROBE_PATH,
  );
}

const VIOLATIONS = [
  ["Math.random", "export const x = Math.random();", "no-restricted-properties"],
  ["Date.now", "export const x = Date.now();", "no-restricted-properties"],
  ["performance.now", "export const x = performance.now();", "no-restricted-properties"],
  ["new Date() reads the clock", "export const x = new Date();", "no-restricted-syntax"],
  ["Date() reads the clock", "export const x = Date();", "no-restricted-syntax"],
  ["dynamic import", "export const x = import('./other.js');", "no-restricted-syntax"],
  ["node: import", "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;", "no-restricted-imports"],
  ["bare fs import", "import { readFileSync } from 'fs';\nexport const x = readFileSync;", "no-restricted-imports"],
  ["http import", "import http from 'http';\nexport const x = http;", "no-restricted-imports"],
  ["child_process import", "import cp from 'child_process';\nexport const x = cp;", "no-restricted-imports"],
  ["fetch", "export const x = fetch('https://example.invalid');", "no-restricted-globals"],
  ["process", "export const x = process.env;", "no-restricted-globals"],
  ["setTimeout", "export const x = setTimeout(() => 0, 1);", "no-restricted-globals"],
  ["console", "export const x = () => console.log('x');", "no-restricted-globals"],
  ["crypto", "export const x = crypto.randomUUID();", "no-restricted-globals"],
  ["globalThis.Math.random", "export const x = globalThis.Math.random();", "no-restricted-globals"],
  ["new globalThis.Date", "export const x = new globalThis.Date();", "no-restricted-globals"],
  ["globalThis.fetch", "export const x = globalThis.fetch('https://example.invalid');", "no-restricted-globals"],
  ["Intl.DateTimeFormat", "export const x = new Intl.DateTimeFormat('en').format();", "no-restricted-properties"],
  ["Temporal.Now", "export const x = Temporal.Now.instant();", "no-restricted-properties"],
  ["Reflect.construct with Date", "export const x = Reflect.construct(Date, []);", "no-restricted-syntax"],
  ["the module specifier", "import { createRequire } from 'module';\nexport const x = createRequire;", "no-restricted-imports"],
  [
    "createRequire from node:module",
    "import { createRequire } from 'node:module';\nexport const x = createRequire;",
    "no-restricted-imports",
  ],
];

for (const [name, code, rule] of VIOLATIONS) {
  test(`R4.1 to R4.9 purity rule rejects ${name} in packages/learning/src`, () => {
    const messages = lint(code);
    assert.ok(
      messages.some((message) => message.ruleId === rule),
      `expected ${rule} for ${name}, got ${JSON.stringify(messages)}`,
    );
  });
}

test("R4.1 to R4.9 purity rule accepts pure code: an injected RandomSource and a given Date", () => {
  const code = [
    "import type { RandomSource } from './types.js';",
    "import { requireCount } from './validate.js';",
    "export function draw(random: RandomSource): number { return random(); }",
    "export function copy(at: Date): Date { return new Date(at.getTime()); }",
    "export const n = requireCount(Math.floor(2.5), 'n');",
  ].join("\n");
  assert.deepEqual(lint(code), []);
});

test("R4.1 to R4.9 eslint.config.js applies the purity block to packages/learning/src only", () => {
  const blocks = config.filter((block) => block.rules === LEARNING_PURITY_RULES);
  assert.equal(blocks.length, 1, "exactly one config block carries the purity rules");
  assert.deepEqual(blocks[0].files, LEARNING_PURITY_FILES);
  assert.deepEqual(LEARNING_PURITY_FILES, ["packages/learning/src/**/*.ts"]);
  assert.deepEqual(learningPurityBlock().files, LEARNING_PURITY_FILES);
});
