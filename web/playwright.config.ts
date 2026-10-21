// Playwright configuration for the end-to-end (e2e) smoke flow (R0.3, R0.7).
//
// Mechanism: `pnpm --filter @g-tee-oh/web run e2e` runs the files under e2e/ that match the
// .e2e.ts suffix against the Compose dev profile. The base address is the edge Caddy on the
// host and must name the one https site Caddy serves, CADDY_SITE (e2e/base-url.ts): it is
// E2E_BASE_URL when set, else https://<CADDY_SITE> with CADDY_SITE from the environment or
// from the repo .env, else https://localhost. Caddy signs with its internal certificate
// authority, which the browser does not trust, so ignoreHTTPSErrors stays on until S29 exports
// that root (O-113). One worker and no retries keep a flake visible. Two reporters: "list"
// prints one line per test, so the terminal and the CI log keep the per-test summary, and
// "html" writes playwright-report/ (traces go to test-results/; both are ignored by git and
// eslint) with `open: "never"` so it never launches a browser after a run.
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import { envFileLookup, resolveBaseUrl } from "./e2e/base-url.js";

const REPORT_DIRECTORY = "playwright-report";
const REPO_ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: REPORT_DIRECTORY, open: "never" }]],
  use: {
    baseURL: resolveBaseUrl(process.env, envFileLookup(REPO_ENV_FILE)),
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
