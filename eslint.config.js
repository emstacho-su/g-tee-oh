// Flat ESLint config shared by every pnpm workspace package (R0.1).
//
// Mechanism: each package's lint script runs "eslint ." from the package directory. ESLint 9 looks
// for eslint.config.js in the working directory and then in each ancestor, so it finds this file at
// the repo root and applies it to the package's own files. Ignore patterns are resolved relative to
// this file, not to the package.
//
// TypeScript files (.ts and .tsx) get the type-checked rule set. The project service resolves the
// nearest tsconfig.json for every linted file, which is why every linted TypeScript file must be
// covered by a package tsconfig: src and test everywhere, plus e2e and the two TypeScript config
// files in web, which its tsconfig lists by name.
//
// packages/learning/src gets the purity block of scripts/lib/learning-purity.mjs on top (S30, A1
// section 2): no I/O, no clock and no randomness except an injected RandomSource.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import { learningPurityBlock } from "./scripts/lib/learning-purity.mjs";

const IGNORED_PATHS = [
  "**/dist/**",
  "**/dist-harness/**",
  "**/coverage/**",
  "**/node_modules/**",
  "**/target/**",
  "crates/**",
  "docs/**",
  ".guard-private/**",
  "web/playwright-report/**",
  "web/test-results/**",
];

export default defineConfig(
  { ignores: IGNORED_PATHS },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  learningPurityBlock(),
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },
);
