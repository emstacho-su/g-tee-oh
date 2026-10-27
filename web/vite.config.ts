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

/**
 * Files the dev server never serves, even under server.fs.allow (S24 security review M1). Vite's
 * own defaults (.env files, certificates and keys, .git) plus the private-data guard's inputs and
 * the Claude Code settings, because under just dev-hot the dev server sits behind the edge Caddy
 * and /@fs/<path> would otherwise serve any file inside the allowed root. Setting fs.deny replaces
 * Vite's list, so the defaults are repeated here.
 *
 * Vite matches these against absolute paths, and Claude Code keeps its git worktrees under
 * .claude/worktrees/, so a plain "**\/.claude/**" would deny every source file when the dev server
 * or vitest runs from a worktree. The .claude patterns therefore deny the files directly in a
 * .claude directory (settings.json and the like) and every subdirectory except worktrees.
 */
export const DEV_SERVER_FS_DENY: readonly string[] = [
  ".env",
  ".env.*",
  "*.{crt,pem}",
  "**/.git/**",
  "**/.guard-private/**",
  "**/.claude/*",
  "**/.claude/!(worktrees)/**",
];
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
      fs: { deny: [...DEV_SERVER_FS_DENY] },
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
