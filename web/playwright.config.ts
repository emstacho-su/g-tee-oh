// Playwright configuration for the end-to-end (e2e) smoke flow (R0.3, R0.7).
//
// Mechanism: `pnpm --filter @g-tee-oh/web run e2e` runs the files under e2e/ that match the
// .e2e.ts suffix against the Compose dev profile. The base address is the edge Caddy on the
// host; E2E_BASE_URL overrides it for the CI runner. Caddy signs with its internal
// certificate authority, which the browser does not trust, so ignoreHTTPSErrors stays on
// until S29 exports that root (O-113). One worker and no retries keep a flake visible. The
// html report lands in playwright-report/ and traces in test-results/, both ignored by git
// and eslint; `open: "never"` stops the reporter from launching a browser after a run.
import { defineConfig, devices } from "@playwright/test";

const DEFAULT_BASE_URL = "https://localhost";
const REPORT_DIRECTORY = "playwright-report";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  retries: 0,
  reporter: [["html", { outputFolder: REPORT_DIRECTORY, open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
