/// <reference types="vitest/config" />
// Vite build and dev server for the web package, plus the vitest block (R0.7, S24).
//
// Mechanism: vite reads this file for `vite`, `vite build` and the dev server; vitest reads the
// same file and takes its options from the `test` key. The reference line above only adds the
// `test` key to vite's config type for the type checker; at run time nothing from vitest is
// imported, so `vite build` also works inside the Docker build stage, which installs the web
// package's own dependencies and never the root devDependencies. The include pattern keeps
// vitest on test/ so the Playwright files under e2e/ are never collected by it.
//
// Two build modes (O-267). The default (production) build has one input, index.html, and is
// what the web image serves. `vite build --mode harness` adds the component gallery
// (gallery.html, the screenshot page) and the matrix frame bench (bench.html) as extra inputs
// and writes to dist-harness/, which only the Playwright mock, bench and shots projects serve
// through `vite preview`. The harness pages therefore never reach the production image.
//
// Tailwind 4 runs as a Vite plugin (O-44: Tailwind with Radix primitives, the A7 fallback,
// because the S07 stack note does not exist). Coverage (v8) holds src/ to 80 percent on
// statements, branches, functions and lines (A9 section 1); the browser entry and the harness
// entries are thin wiring that the Playwright projects exercise instead.
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEV_SERVER_PORT = 5173;
const HARNESS_MODE = "harness";
const HARNESS_OUT_DIR = "dist-harness";
const COVERAGE_THRESHOLD_PERCENT = 80;

function entry(file: string): string {
  return fileURLToPath(new URL(file, import.meta.url));
}

export default defineConfig(({ mode }) => {
  const harness = mode === HARNESS_MODE;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: DEV_SERVER_PORT,
    },
    build: harness
      ? {
          outDir: HARNESS_OUT_DIR,
          rollupOptions: {
            input: {
              main: entry("./index.html"),
              gallery: entry("./gallery.html"),
              bench: entry("./bench.html"),
            },
          },
        }
      : {},
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/main.tsx", "src/gallery/**", "src/bench/**", "src/**/*.d.ts"],
        thresholds: {
          statements: COVERAGE_THRESHOLD_PERCENT,
          branches: COVERAGE_THRESHOLD_PERCENT,
          functions: COVERAGE_THRESHOLD_PERCENT,
          lines: COVERAGE_THRESHOLD_PERCENT,
        },
      },
    },
  };
});
