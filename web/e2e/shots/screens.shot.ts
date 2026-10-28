/**
 * Screenshot pass for the owner's review (S24 step 3, O-67, O-266), moved onto the shared helpers
 * in S25 (O-289). The shots project serves the harness build (vite preview on 4173, O-267) with
 * the mocked api (O-264), so no Docker is needed and the pictures show synthetic data only (O-26).
 *
 * Mechanism: one test per theme and width. Each test prepares the page (support/shots.ts), walks
 * the login, the home shell, the shortcuts overlay and a placeholder route, then every gallery
 * section, and saves PNGs as <screen>-<theme>-<width>.png into the shot folder (SCREENSHOT_DIR,
 * default test-results/shots). afterAll merges its records into manifest.json beside the PNGs
 * (support/shot-manifest.ts), so the S25 study and trainer files add to the same manifest.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { installMockApi } from "../support/mock-api.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";

const CRITERIA = {
  login: "S42 two-step sign-in, step 1: a centred column with one email field and Continue; no request is sent yet (O-349, DoD 1)",
  loginPassword: "S42 sign-in step 2: the email as a read-only chip, the password with show and hide, Sign in and Use a different email (O-349)",
  loginError: "S42 a rejected sign-in shows one fixed message on step 2, the same for an unknown email and a wrong password, never the server detail",
  home: "Home shell renders after sign in, the smoke flow's landing page (DoD 1, R3.13)",
  placeholder: "Route placeholders render under the shell (DoD 1, A7 section 2)",
  shortcuts: "Keyboard-first: the ? shortcuts overlay (A7 section 4, R3.13 hotkeys)",
  table: "PokerTable: 6 to 9 seats, stacks, pot, button, bets, straddle marker (R3.13)",
  cards: "CardView and BoardReveal (R3.13)",
  actionBar: "ActionBar: buttons from the node's tree actions, exact size preflop, bucket with size postflop (R3.13, O-22, ADR 0020)",
  confidence: "ConfidenceTap: sure or unsure before the reveal (R3.13)",
  roller: "RngRoller: the roll and the cumulative bands (R3.13, O-213)",
  feedback: "FeedbackPanel shell: label, EV loss in bb and percent pot, the hand's frequencies (R3.13)",
  panels: "ActionFrequencyTable and ThresholdCard (R3.12, R3.13)",
  matrix: "RangeMatrix canvas with per-cell action frequency bars; color never the only signal (R3.12, A7 section 4)",
  matrixEv: "RangeMatrix EV mode (R3.12)",
  matrixWeight: "RangeMatrix range-weight mode (R3.12)",
  matrixTable: "The accessible table fallback renders the same data (DoD 3, R3.12)",
  explainer: "R3.10 RNG explainer: why randomize, how the roll works with the band example, why it is optional (05 section 7, ADR 0009, O-283)",
  rollBadge: "R3.10 before the decision only the roll shows, never the bands (O-282)",
  feedbackWired: "R3.10 R3.13 feedback after the reveal: roller with the roll-selected action labeled Best, range view and threshold card (O-281, O-282)",
} as const;

const GALLERY_SECTIONS: readonly (readonly [string, string])[] = [
  ["poker-table-6", CRITERIA.table],
  ["poker-table-9", CRITERIA.table],
  ["cards", CRITERIA.cards],
  ["board-reveal", CRITERIA.cards],
  ["action-bar", CRITERIA.actionBar],
  ["confidence-tap", CRITERIA.confidence],
  ["rng-roller", CRITERIA.roller],
  ["feedback-panel", CRITERIA.feedback],
  ["rng-explainer", CRITERIA.explainer],
  ["roll-badge", CRITERIA.rollBadge],
  ["feedback-wired", CRITERIA.feedbackWired],
  ["action-frequency-table", CRITERIA.panels],
  ["threshold-card", CRITERIA.panels],
  ["range-matrix-frequency", CRITERIA.matrix],
  ["range-matrix-ev", CRITERIA.matrixEv],
  ["range-matrix-weight", CRITERIA.matrixWeight],
  ["range-matrix-table", CRITERIA.matrixTable],
];

const records: ShotRecord[] = [];

async function appScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installMockApi(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await shot("login", CRITERIA.login);

  await page.getByLabel("Email").fill("someone-else@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("email-chip")).toBeVisible();
  await shot("login-password", CRITERIA.loginPassword);

  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await shot("login-error", CRITERIA.loginError);

  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await shot("home", CRITERIA.home);

  await page.keyboard.press("?");
  const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(overlay).toBeVisible();
  await shot("shortcuts-overlay", CRITERIA.shortcuts);
  await page.keyboard.press("Escape");

  // /study became a real screen in S25; /library is still a placeholder (S28).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("placeholder-library", CRITERIA.placeholder);
}

async function galleryScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  await page.goto(`/gallery.html?theme=${theme}`);
  const tableSection = page.getByTestId("gallery-range-matrix-table");
  await tableSection.getByRole("button", { name: "Show as table" }).click();
  for (const [name, criterion] of GALLERY_SECTIONS) {
    const section = page.getByTestId(`gallery-${name}`);
    await section.scrollIntoViewIfNeeded();
    records.push(await capture(section, page, OUT_DIR, { screen: `gallery-${name}`, theme, viewport, criterion, source: SOURCE }));
  }
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, "S24", records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.12 R3.13 screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await appScreens(page, theme, viewport);
      await galleryScreens(page, theme, viewport);
    });
  }
}
