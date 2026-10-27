// Playwright configuration: four projects over two targets (R0.3, R0.7, R3.12, R3.13).
//
// Mechanism: each project has its own test directory and file suffix, and `pnpm run <script>`
// selects one with --project (web/package.json: e2e, e2e:mock, bench, shots).
//
// - stack (e2e/stack, *.e2e.ts): the smoke and the sign-in flow against the Compose dev profile
//   through the edge Caddy. The base address must name the one https site Caddy serves,
//   CADDY_SITE (e2e/base-url.ts): E2E_BASE_URL when set, else https://<CADDY_SITE> with
//   CADDY_SITE from the environment or from the repo .env, else https://localhost. Caddy signs
//   with its internal certificate authority, which the browser does not trust, so
//   ignoreHTTPSErrors stays on until S29 exports that root (O-113). The sign-in test reads the
//   per-run owner that infra/compose/e2e.mjs creates (O-263).
// - mock (e2e/mock, *.e2e.ts): the same sign-in flow against `vite preview` of the harness build
//   on http://localhost:4173, with /api/v1 answered by e2e/support/mock-api.ts; no Docker (O-264).
// - bench (e2e/bench, *.bench.ts): the matrix frame bench on the harness build (O-260), one
//   worker and a ten-minute budget per test, run only under the bench lock.
// - shots (e2e/shots, *.shot.ts): the screenshot pass over the harness gallery (T3, O-67).
//
// The preview server: webServer builds the harness (`build:harness`, dist-harness/, O-267) and
// serves it with `preview:harness` on 4173. Playwright's webServer is config-wide, so it is set
// only when the selected projects need it (e2e/support/preview-server.ts reads --project; no
// --project means every project): the stack project alone never builds or starts it. Outside CI
// an already running preview is reused. One worker and no retries keep a flake visible. Two
// reporters: "list" prints one line per test for the terminal and the CI log, and "html" writes
// playwright-report/ (traces go to test-results/; both are ignored by git and eslint) with
// `open: "never"` so it never launches a browser after a run.
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import { envFileLookup, resolveBaseUrl } from "./e2e/base-url.js";
import { needsPreviewServer } from "./e2e/support/preview-server.js";

const REPORT_DIRECTORY = "playwright-report";
const REPO_ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
const PREVIEW_URL = "http://localhost:4173";
const PREVIEW_COMMAND = "pnpm run build:harness && pnpm run preview:harness";
const PREVIEW_START_TIMEOUT_MS = 120_000;
const BENCH_TEST_TIMEOUT_MS = 10 * 60_000;
const E2E_SUFFIX = "**/*.e2e.ts";

const desktop = devices["Desktop Chrome"];
const inCi = process.env.CI !== undefined && process.env.CI !== "";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: REPORT_DIRECTORY, open: "never" }]],
  projects: [
    {
      name: "stack",
      testDir: "e2e/stack",
      testMatch: E2E_SUFFIX,
      use: {
        ...desktop,
        baseURL: resolveBaseUrl(process.env, envFileLookup(REPO_ENV_FILE)),
        ignoreHTTPSErrors: true,
      },
    },
    {
      name: "mock",
      testDir: "e2e/mock",
      testMatch: E2E_SUFFIX,
      use: { ...desktop, baseURL: PREVIEW_URL },
    },
    {
      name: "bench",
      testDir: "e2e/bench",
      testMatch: "**/*.bench.ts",
      timeout: BENCH_TEST_TIMEOUT_MS,
      workers: 1,
      use: { ...desktop, baseURL: PREVIEW_URL },
    },
    {
      name: "shots",
      testDir: "e2e/shots",
      testMatch: "**/*.shot.ts",
      use: { ...desktop, baseURL: PREVIEW_URL },
    },
  ],
  ...(needsPreviewServer(process.argv, process.env)
    ? {
        webServer: {
          command: PREVIEW_COMMAND,
          url: PREVIEW_URL,
          reuseExistingServer: !inCi,
          timeout: PREVIEW_START_TIMEOUT_MS,
        },
      }
    : {}),
});
