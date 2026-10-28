/**
 * Flow 6 (A7 section 5): progress and click to drill on the compose stack (S32, R4.12, O-321,
 * O-324). Part of the stack project, which the CI e2e job runs after flow 1; without
 * E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD it skips like sign-in.e2e.ts.
 *
 * Mechanism, over the e2e owner that `just fixture-learning` seeds (a schedule card for every
 * catalog class, and leak history for the six Mondays before this week over ten classes): sign
 * in, open /progress, and check structure only, since the seeded numbers are the seed's to change:
 * at least one leak trend row, each with a sparkline; at least one heat map cell; both table
 * fallbacks list one row per trend row and per cell and switch back. Then a heat map cell opens a
 * drill: the class's auto drill is found by its tag or created from the catalog configs, and the
 * drill run screen opens (/drills/<id>/run).
 *
 * When SCREENSHOT_DIR is set the flow runs once per theme and width (1440 and 390) and captures
 * /progress as the stack serves it, merged into the manifest with session S32 and source stack.
 */
import { expect, test, type Page } from "@playwright/test";

import { expectHeatCells, expectTrendRows, openDrillFromCell, openProgress, toggleBothTables } from "../support/flow-6.js";
import { ownerCredentials } from "../support/owner-credentials.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, DESKTOP, prepareShotPage, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { signIn } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "R4.12 flow 6 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";
const SHOTS = (process.env["SCREENSHOT_DIR"] ?? "") !== "";
const OUT_DIR = shotDirectory();
const SESSION = "S32";
const SOURCE = "stack";
const FLOW_TIMEOUT_MS = 120_000;
const CRITERION = "R4.12 flow 6 on the stack: /progress with the seeded leak-cost trend (rows with sparklines) and the mastery heat map (practiced and new cells)";

const records: ShotRecord[] = [];

async function flow6(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  if (credentials === undefined) return;
  await signIn(page, credentials);
  await openProgress(page);

  const trendRows = await expectTrendRows(page);
  expect(trendRows).toBeGreaterThanOrEqual(1);
  const heatCells = await expectHeatCells(page);
  expect(heatCells).toBeGreaterThanOrEqual(1);
  if (SHOTS) {
    records.push(await capture(page, page, OUT_DIR, { screen: "flow6-progress", theme, viewport, criterion: CRITERION, source: SOURCE }));
  }

  await toggleBothTables(page, trendRows, heatCells);
  await openDrillFromCell(page, page.getByTestId("heat-cell").first());
}

test.afterAll(() => {
  if (SHOTS) mergeShotManifest(OUT_DIR, SESSION, records);
});

const RUN_THEMES: readonly Theme[] = SHOTS ? THEMES : ["light"];
const RUN_VIEWPORTS: readonly Viewport[] = SHOTS ? VIEWPORTS : [DESKTOP];

for (const theme of RUN_THEMES) {
  for (const viewport of RUN_VIEWPORTS) {
    test(`R4.12 flow 6: progress trend, heat map, table fallbacks and click to drill on the stack, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.skip(credentials === undefined, SKIP_REASON);
      test.setTimeout(FLOW_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await flow6(page, theme, viewport);
    });
  }
}
