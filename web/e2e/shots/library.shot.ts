/**
 * Coverage view and builder screenshots for the owner's review (S28, R3.4, R3.5, O-289, O-290,
 * O-299). The shots project serves the harness build with the mocked api (support/mock-app.ts)
 * and a fake event stream (support/mock-events.ts), so the pictures show the synthetic fixtures
 * of src/fixtures/library.ts only (O-26).
 *
 * Mechanism: one test per theme and width. The admin test signs in, opens /library at the online
 * 6-max 100 bb configuration with BB-BTN selected and captures the grid with families and queue,
 * a recorded preflop gap, a queued flop request with its position, a coverage_added
 * announcement, the builder panel running and paused, a saved settings edit, and /settings with
 * the builder schedule. A second test per theme and width captures a member's /library (no
 * builder controls). afterAll merges the records into the shared manifest.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_QUEUE_PAIR, FIXTURE_REQUESTED_FLOP } from "../../src/fixtures/library.js";
import { FIXTURE_ONLINE_STAKE_ID } from "../../src/fixtures/study.js";
import { installAppMockApi } from "../support/mock-app.js";
import { emitServerEvent, installFakeEventSource } from "../support/mock-events.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S40";
const SOURCE = "mock";
const OWNER = { email: FIXTURE_USER_EMAIL, password: "synthetic-password" };
const LIBRARY_PATH = `/library?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000`;
const UNCOVERED_PAIR = "CO-BTN";

const CRITERIA = {
  grid: "R3.4 coverage view: pair grid with preflop availability in words, flops by texture family, build queue with positions (A7 sections 2 and 3, O-291)",
  recorded: "R3.4 gap request from an uncovered pair: preflop gap recorded, no queue position (O-240)",
  queued: "R3.4 flow 5: a queued flop requested, answered at once at queue position 1 and moved to the head of the queue (ADR 0018, O-240)",
  live: "R3.4 live update: a coverage_added event announced in the live region (O-243, O-297)",
  running: "R3.5 admin builder health running: state, queue depth, flops per day, storage against budget, labeled placeholders (A9 section 4, O-299)",
  paused: "R3.5 admin builder paused after Pause; Resume offered (O-295)",
  saved: "R3.5 settings edit round trip: CPU share and budget saved, stored values shown (O-296)",
  schedule: "R3.5 /settings/builder-schedule: the overnight window form on its own settings page, listed for admins only (O-296, O-360, O-361)",
  member: "O-290 a member's /library: coverage view without builder controls",
} as const;

const records: ShotRecord[] = [];

function shooter(page: Page, theme: Theme, viewport: Viewport) {
  return async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
}

async function openLibrary(page: Page, admin: boolean): Promise<void> {
  await installFakeEventSource(page);
  await installAppMockApi(page, { admin });
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

async function coverageScreens(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  await page.goto(`${LIBRARY_PATH}&pair=${FIXTURE_QUEUE_PAIR}`);
  await expect(page.getByRole("table", { name: "Build queue for this pair" })).toBeVisible();
  await expect(page.getByTestId("live-status")).toHaveText("Live updates are on.");
  await shot("library-coverage-grid", CRITERIA.grid);

  await page.getByRole("button", { name: `Request ${FIXTURE_REQUESTED_FLOP}` }).click();
  await expect(page.getByTestId("gap-request-result")).toContainText("position 1");
  await expect(page.getByRole("table", { name: "Build queue for this pair" }).getByRole("row").nth(1)).toContainText(FIXTURE_REQUESTED_FLOP);
  await shot("library-gap-queued", CRITERIA.queued);

  await emitServerEvent(page, "coverage_added", { config_id: "cfg_6_online_100", pair: FIXTURE_QUEUE_PAIR, flop: "Kd8s3h", build_id: "synthetic", scenario_count: 20 });
  await expect(page.getByTestId("live-coverage")).toContainText("New coverage");
  await shot("library-live-coverage", CRITERIA.live);

  await page.getByRole("list", { name: "Pairs" }).getByRole("button", { name: new RegExp(`^${UNCOVERED_PAIR}`) }).click();
  await page.getByRole("button", { name: `Request ${UNCOVERED_PAIR} preflop` }).click();
  await expect(page.getByTestId("gap-request-result")).toContainText("Recorded for the planner");
  await shot("library-gap-recorded", CRITERIA.recorded);
}

async function builderScreens(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  const health = page.getByRole("region", { name: "Builder health" });
  await expect(page.getByTestId("builder-state")).toHaveText("Running");
  await health.scrollIntoViewIfNeeded();
  await shot("library-admin-running", CRITERIA.running);

  await page.getByRole("button", { name: "Pause the builder" }).click();
  await expect(page.getByTestId("builder-state")).toHaveText("Paused");
  await shot("library-admin-paused", CRITERIA.paused);
  await page.getByRole("button", { name: "Resume the builder" }).click();
  await expect(page.getByTestId("builder-state")).toHaveText("Running");

  await page.getByRole("spinbutton", { name: "CPU share" }).fill("0.75");
  await page.getByRole("spinbutton", { name: "Storage budget (GB)" }).fill("500");
  await page.getByRole("button", { name: "Save builder settings" }).click();
  await expect(page.getByText("Saved. The builder reads the new settings before its next job.")).toBeVisible();
  await shot("library-settings-saved", CRITERIA.saved);

  // Since S36 the schedule is its own settings page, listed for admins only (O-360, O-361).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Builder schedule" }).click();
  await expect(page).toHaveURL(/\/settings\/builder-schedule$/);
  await expect(page.getByRole("form", { name: "Builder schedule" })).toBeVisible();
  await shot("settings-builder-schedule", CRITERIA.schedule);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.4 R3.5 library screenshots, admin, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await openLibrary(page, true);
      const shot = shooter(page, theme, viewport);
      await coverageScreens(page, shot);
      await builderScreens(page, shot);
    });

    test(`R3.5 O-290 library screenshot, member, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await openLibrary(page, false);
      await page.goto(`${LIBRARY_PATH}&pair=${FIXTURE_QUEUE_PAIR}`);
      await expect(page.getByText("Builder health and controls are for admins.")).toBeVisible();
      await shooter(page, theme, viewport)("library-member", CRITERIA.member);
    });
  }
}
