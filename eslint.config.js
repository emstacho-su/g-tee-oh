// Flat ESLint config shared by every pnpm workspace package (R0.1).
//
// Mechanism: each package's lint script runs "eslint ." from the package directory. ESLint 9 looks
// for eslint.config.js in the working directory and then in each ancestor, so it finds this file at
// the repo root and applies it to the package's own files. Ignore patterns are resolved relative to
// this file, not to the package.
//
// TypeScript files get the type-checked rule set. The project service resolves the nearest
// tsconfig.json for every linted file, which is why every .ts file must be covered by a package
// tsconfig (src and test are; config files written in TypeScript would not be).
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const IGNORED_PATHS = [
  "**/dist/**",
  "**/node_modules/**",
  "**/target/**",
  "crates/**",
  "docs/**",
  ".guard-private/**",
];

export default defineConfig(
  { ignores: IGNORED_PATHS },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },
);
