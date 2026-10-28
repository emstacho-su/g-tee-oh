/**
 * Study browser screenshots for the owner's review (S25, S39, R3.12, O-57, O-286, O-289, O-354).
 * The shots project serves the harness build with the mocked api (support/mock-app.ts), so the
 * pictures show the synthetic fixtures of src/fixtures/study.ts only (O-26).
 *
 * Mechanism: one test per theme and width. Each signs in through the login form and captures the
 * settings panel empty, then with live 9-player choices made so unavailable choices show their
 * reasons; then opens /study at the online 6-max 100 bb configuration and BB-BTN by link (a
 * complete link opens the solution with the settings summarized) and captures frequency, EV and
 * range-weight modes and the threshold card after selecting a cell; then follows the next likely
 * action from the position carousel's drop-down to the big blind's decision, opens the reraise
 * line where BTN decides again (a second-orbit carousel item), and captures the synthetic banner
 * on its own (it shows in every solution shot too). afterAll merges the records into the shared
 * manifest (support/shot-manifest.ts).
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_GRANDCHILD_LINE, FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S39";
const SOURCE = "mock";
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const STUDY_PATH = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;

const CRITERIA = {
  settings: "R3.12 settings first: the spot settings panel before any solution, Confirm disabled until every choice is made (O-354)",
  choices: "R3.12 settings panel with live 9-player choices: unavailable table size and stake shown with their reasons (O-354)",
  frequency: "R3.12 study browser, frequency mode: settings summary, position carousel with the actions drop-down, matrix (O-354)",
  ev: "R3.12 study browser, EV mode (A7 section 3)",
  weight: "R3.12 study browser, range-weight mode (A7 section 3, row 28 unchanged)",
  threshold: "R3.12 threshold card open for the selected hand, loaded only on selection (A7 section 3, O-286)",
  line: "R3.12 one step down the next likely action: BTN shows its raise, BB to act with its actions as buttons (O-354)",
  reraise: "R3.12 a decision past the first orbit: BTN facing the reraise gets its own carousel item (O-354)",
  banner: "O-57 synthetic banner on a synthetic node (R3.12); it also shows in every other solution shot",
} as const;

const records: ShotRecord[] = [];

async function settingsScreens(page: Page, shot: (screen: string, criterion: string) => Promise<void>): Promise<void> {
  await page.goto("/study");
  await expect(page.getByRole("region", { name: "Spot settings" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Online" })).toBeVisible();
  await shot("study-settings", CRITERIA.settings);

  await page.getByRole("radio", { name: "Live" }).click();
  await page.getByRole("radiogroup", { name: "Table size" }).getByRole("radio", { name: /^9 players/ }).click();
  await expect(page.getByRole("radiogroup", { name: "Stake" }).getByRole("radio", { name: /^2\/5/ })).toBeVisible();
  await shot("study-settings-choices", CRITERIA.choices);
}

async function solutionScreens(page: Page, shot: (screen: string, criterion: string) => Promise<void>): Promise<void> {
  await page.goto(STUDY_PATH);
  await expect(page.getByRole("img", { name: /frequency mode/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "BTN's actions" })).toBeVisible();
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
}

async function lineScreens(page: Page, shot: (screen: string, criterion: string) => Promise<void>): Promise<void> {
  await page.getByRole("region", { name: "BTN's actions" }).locator('[data-next-likely="true"]').click();
  await expect(page.getByText(/BB to act/)).toBeVisible();
  await expect(page.getByRole("region", { name: "BB's actions" })).toBeVisible();
  await shot("study-line-step", CRITERIA.line);

  await page.goto(`${STUDY_PATH}&line=${FIXTURE_GRANDCHILD_LINE}`);
  await expect(page.getByRole("list", { name: "Positions" }).getByRole("button")).toHaveCount(7);
  await expect(page.getByRole("region", { name: "BTN's actions" })).toBeVisible();
  await shot("study-carousel-reraise", CRITERIA.reraise);
}

async function studyScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await settingsScreens(page, shot);
  await solutionScreens(page, shot);
  await lineScreens(page, shot);

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
