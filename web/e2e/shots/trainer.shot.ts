/**
 * Screenshot pass of the trainer in spot mode for the owner's review (S25, R3.13, R3.11, R3.10,
 * O-282, O-283, O-289). The shots project serves the harness build with the mocked app api
 * (support/mock-app.ts: the auth, study and session routes, O-264), so the pictures show the
 * synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width, each in a fresh browser context, so the RNG explainer
 * is unseen (O-283). The test signs in, opens /drills/<fixture drill>/run and captures the start
 * panel with RNG mode switched on, the prompt with the roll shown and no bands, the explainer from
 * the I key, the confidence tap after choosing an action, the feedback (label, frequencies, roller,
 * range view, threshold card) and the recap after ending. The explainer that opens by itself on
 * first use is closed before a shot that is not about it. afterAll merges the records into the
 * shared manifest with session S25 and source mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S25";
const RUN_PATH = `/drills/${FIXTURE_DRILL_ID}/run`;
const EXPLAINER_NAME = "How RNG mode works";
const CHOSEN_ACTION = "Raise to 2.5bb";

const CRITERIA = {
  start: "R3.13 start panel: drill name, grouping, stop rule, RNG mode switch and Start (O-283, O-288)",
  prompt: "R3.10 roll shown before the decision, bands hidden (O-282); R3.13 table, cards, action so far, synthetic banner (O-57)",
  explainer: "R3.10 RNG explainer opened with the I key: why randomize, how the roll works, why it is optional (05 section 7)",
  confidence: "R3.11 confidence tap before any reveal (05 section 5): the choice is shown, nothing is revealed (O-284)",
  feedback: "R3.13 feedback after the tap: label, EV loss, frequencies, roller with the roll-selected action Best, range view and threshold card (O-281, O-282)",
  recap: "R3.13 session recap after End session and its confirm (O-285)",
} as const;

const records: ShotRecord[] = [];

/** Closes the explainer when it opened by itself on first use (O-283). */
async function closeExplainerIfOpen(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: EXPLAINER_NAME });
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}

async function trainerScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto(RUN_PATH);
  await expect(page.getByRole("heading", { name: fixtureDrill.name })).toBeVisible();
  await page.getByRole("switch", { name: "RNG mode" }).click();
  await closeExplainerIfOpen(page);
  await expect(page.getByRole("switch", { name: "RNG mode" })).toHaveAttribute("aria-checked", "true");
  await shot("trainer-start", CRITERIA.start);

  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByTestId("roll-badge")).toBeVisible();
  await closeExplainerIfOpen(page);
  await shot("trainer-prompt-roll", CRITERIA.prompt);

  await page.keyboard.press("i");
  await expect(page.getByRole("dialog", { name: EXPLAINER_NAME })).toBeVisible();
  await shot("trainer-explainer", CRITERIA.explainer);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: EXPLAINER_NAME })).toBeHidden();

  await page.getByRole("button", { name: CHOSEN_ACTION }).click();
  await expect(page.getByTestId("confidence-tap")).toBeVisible();
  await expect(page.getByTestId("feedback-panel")).toHaveCount(0);
  await shot("trainer-confidence", CRITERIA.confidence);

  await page.getByRole("button", { name: "Sure" }).click();
  await expect(page.getByTestId("feedback-panel")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot("trainer-feedback", CRITERIA.feedback);

  await page.keyboard.press("e");
  const confirm = page.getByRole("dialog", { name: "End this session?" });
  await confirm.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "Session recap" })).toBeVisible();
  await shot("trainer-recap", CRITERIA.recap);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.10 R3.11 R3.13 trainer screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await trainerScreens(page, theme, viewport);
    });
  }
}
