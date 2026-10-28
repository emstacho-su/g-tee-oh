/**
 * Screenshot pass of /train for the owner's review (S32, R4.10, R4.12, O-272, O-284, O-325,
 * O-328). The shots project serves the harness build with the mocked app api (support/mock-app.ts,
 * the automated and holdout sessions of support/mock-automated.ts, O-264), so the pictures show the
 * synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width (light and dark, 1440 and 390), each in a fresh browser
 * context. The test signs in, opens /train and captures the start panel; starts and captures the
 * first prompt of the rated block with its banner; decides and captures the feedback; plays the
 * rest of the rated block and captures the first prompt of the worked example; opens the end
 * confirm and captures it; ends and captures the recap (three rated decisions, so it has a rating
 * change, a tier and an unlock); then opens /train?mode=holdout, starts the retest and captures
 * its banner. afterAll merges the records into the shared manifest with session S32 and source
 * mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_BLOCK_SIZE } from "../../src/fixtures/automated.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S32";

const CRITERIA = {
  start: "R4.10 automated start: one line on what it does, configuration scope, grouping and RNG from the session defaults, a Settings link and Start; no seed offered (O-323, O-325)",
  prompt: "R4.10 rated block prompt: banner with family, track name, hand 1 of 3 in the block and that it counts toward the rating, above the table and actions (O-272)",
  feedback: "R4.10 R3.11 feedback after the confidence tap: label, EV loss, frequencies, range view and threshold card, Next and End session (O-284)",
  worked: "R4.10 worked example prompt: banner says Worked example: panels visible, not rated (O-272, O-325)",
  confirm: "R4.10 end confirm: End this session? with Keep playing and End session (O-285)",
  recap: "R4.10 recap: decisions, rated decisions, mean score percent, EV loss, per-track rating before (new) and after with RD, tier held by a named track, the unlocked badge, Train again and See progress (O-325)",
  holdout: "R4.10 holdout retest in the session view: banner says Holdout retest: not rated with answered of total (O-328)",
} as const;

const records: ShotRecord[] = [];

async function decide(page: Page): Promise<void> {
  await page.getByRole("group", { name: "Actions" }).getByRole("button").first().click();
  await expect(page.getByTestId("confidence-tap")).toBeVisible();
  await page.getByRole("button", { name: "Sure", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toBeVisible();
}

async function nextHand(page: Page): Promise<void> {
  await page.keyboard.press("n");
  await expect(page.getByRole("group", { name: "Actions" })).toBeVisible();
}

async function trainScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto("/train");
  await expect(page.getByTestId("automated-start")).toBeVisible();
  await shot("train-start", CRITERIA.start);

  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByTestId("block-hand")).toHaveText("Hand 1 of 3 in this block");
  await expect(page.getByTestId("block-class")).toContainText("Opens");
  await shot("train-prompt-rated", CRITERIA.prompt);

  await decide(page);
  await page.waitForLoadState("networkidle");
  await shot("train-feedback", CRITERIA.feedback);
  for (let hand = 1; hand < FIXTURE_BLOCK_SIZE; hand += 1) {
    await nextHand(page);
    await decide(page);
  }
  await nextHand(page);
  await expect(page.getByTestId("block-rating")).toHaveText("Worked example: panels visible, not rated");
  await shot("train-worked-example", CRITERIA.worked);

  await page.keyboard.press("e");
  const confirm = page.getByRole("dialog", { name: "End this session?" });
  await expect(confirm).toBeVisible();
  await shot("train-end-confirm", CRITERIA.confirm);
  await confirm.getByRole("button", { name: "End session" }).click();
  await expect(page.getByTestId("recap-unlocks")).toBeVisible();
  await shot("train-recap", CRITERIA.recap);

  await page.goto("/train?mode=holdout");
  await page.getByRole("button", { name: "Start the retest" }).click();
  await expect(page.getByTestId("holdout-answered")).toHaveText("12 of 30 answered");
  await shot("train-holdout", CRITERIA.holdout);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R4.10 train screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await trainScreens(page, theme, viewport);
    });
  }
}
