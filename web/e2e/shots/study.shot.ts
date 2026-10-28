/**
 * Study browser screenshots for the owner's review (S25, R3.12, O-57, O-286, O-289). The shots
 * project serves the harness build with the mocked api (support/mock-app.ts), so the pictures show
 * the synthetic fixtures of src/fixtures/study.ts only (O-26).
 *
 * Mechanism: one test per theme and width. Each signs in through the login form, opens /study at
 * the online 6-max 100 bb configuration and BB-BTN, and captures the browser in frequency, EV and
 * range-weight modes, the threshold card after selecting a cell, the line one step down the next
 * likely action with its breadcrumb, and the synthetic banner on its own (it shows in every
 * other shot too). afterAll merges the records into the shared manifest (support/shot-manifest.ts).
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S25";
const SOURCE = "mock";
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const STUDY_PATH = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;

const CRITERIA = {
  frequency: "R3.12 study browser, frequency mode: 13 by 13 matrix, actions table, filters (A7 section 3)",
  ev: "R3.12 study browser, EV mode (A7 section 3)",
  weight: "R3.12 study browser, range-weight mode (A7 section 3)",
  threshold: "R3.12 threshold card open for the selected hand, loaded only on selection (A7 section 3, O-286)",
  line: "R3.12 a line one step down the next likely action, with the breadcrumb (O-286)",
  banner: "O-57 synthetic banner on a synthetic node (R3.12); it also shows in every other study shot",
} as const;

const records: ShotRecord[] = [];

async function studyScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto(STUDY_PATH);
  await expect(page.getByRole("img", { name: /frequency mode/ })).toBeVisible();
  await shot("study-frequency", CRITERIA.frequency);

  await page.getByRole("radio", { name: "EV" }).click();
  await expect(page.getByRole("img", { name: /expected value mode/ })).toBeVisible();
  await shot("study-ev", CRITERIA.ev);

  await page.getByRole("radio", { name: "Range weight" }).click();
  await expect(page.getByRole("img", { name: /range weight mode/ })).toBeVisible();
  await shot("study-weight", CRITERIA.weight);

  await page.getByRole("radio", { name: "Frequency" }).click();
  await page.getByRole("group", { name: /Range matrix cells/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("threshold-card")).toBeVisible();
  await shot("study-threshold-card", CRITERIA.threshold);

  await page.getByRole("list", { name: "Actions at this node" }).locator('[data-next-likely="true"]').click();
  await expect(page.getByText(/BB to act/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Line" })).toBeVisible();
  await shot("study-line-step", CRITERIA.line);

  const banner = page.getByTestId("synthetic-banner");
  records.push(await capture(banner, page, OUT_DIR, { screen: "study-synthetic-banner", theme, viewport, criterion: CRITERIA.banner, source: SOURCE }));
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.12 study screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await studyScreens(page, theme, viewport);
    });
  }
}
