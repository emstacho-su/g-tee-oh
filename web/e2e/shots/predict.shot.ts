/**
 * Screenshot pass of the prediction drills for the owner's review (S27 lane A, R3.16, O-301,
 * O-266, O-289). The shots project serves the harness build with the mocked app api
 * (support/mock-app.ts, with mock-prediction.ts answering the drill list, the prediction session
 * and its prompts, O-264), so the pictures show the synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width, each in a fresh browser context. The test signs in,
 * opens /predict and captures the drill picker, then follows the fixture drill's link and walks the
 * mocked session: the range level 1 yes or no prompt, its right answer's result with the level
 * unlocked, then each next prompt (hand action, range percent, hand band, range regions, hand
 * size), answering each to reach the next. afterAll merges the records into the shared manifest
 * with session S27 and source mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { fixturePredictionPrompt } from "../../src/fixtures/prediction.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S27";
const SUBMIT = "Submit answer";
const NEXT = "Next question";

const CRITERIA = {
  picker: "R3.16 drill picker on /predict: the user's drills as links that start a prediction session (O-302)",
  rangeYesNo: "R3.16 range ladder level 1: yes or no against a threshold share, level badge, synthetic banner, no strategy shown before the answer (O-301, O-302)",
  rangePercent: "R3.16 range ladder level 2: the share to the nearest 5 percent in a number field (O-301)",
  rangeRegions: "R3.16 range ladder level 3: which named hand regions hold a mixed class, as checkboxes (O-301)",
  handAction: "R3.16 hand ladder level 1: the hand's most frequent action, buttons from the node's tree actions with swatches (O-301, ADR 0020)",
  handBand: "R3.16 hand ladder level 2: the frequency band of the hand's most frequent action (O-301)",
  handSize: "R3.16 hand ladder level 3: the size the hand raises with most, over the aggressive actions only (O-301)",
  resultUnlocked: "R3.16 result: correct as word and symbol, the solver's answer, Next level unlocked, the window count; unrated, no score (O-301)",
} as const;

const records: ShotRecord[] = [];

async function showsQuestion(page: Page, kind: Parameters<typeof fixturePredictionPrompt>[0]): Promise<void> {
  await expect(page.getByRole("heading", { name: fixturePredictionPrompt(kind).question })).toBeVisible();
}

async function submitAndNext(page: Page): Promise<void> {
  await page.getByRole("button", { name: SUBMIT }).click();
  await expect(page.getByTestId("prediction-result")).toBeVisible();
  await page.getByRole("button", { name: NEXT }).click();
}

async function predictScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto("/predict");
  await expect(page.getByRole("link", { name: fixtureDrill.name })).toBeVisible();
  await shot("predict-picker", CRITERIA.picker);

  await page.getByRole("link", { name: fixtureDrill.name }).click();
  await showsQuestion(page, "yes_no");
  await shot("predict-range-yes-no", CRITERIA.rangeYesNo);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.getByRole("button", { name: SUBMIT }).click();
  await expect(page.getByTestId("level-unlocked")).toBeVisible();
  await shot("predict-result-unlocked", CRITERIA.resultUnlocked);
  await page.getByRole("button", { name: NEXT }).click();

  await showsQuestion(page, "action");
  await shot("predict-hand-action", CRITERIA.handAction);
  await page.getByRole("button", { name: /Raise to 10bb/ }).click();
  await submitAndNext(page);

  await showsQuestion(page, "percent");
  await shot("predict-range-percent", CRITERIA.rangePercent);
  await page.getByRole("spinbutton").fill("40");
  await submitAndNext(page);

  await showsQuestion(page, "band");
  await shot("predict-hand-band", CRITERIA.handBand);
  await page.getByRole("button", { name: "50 to 75 percent" }).click();
  await submitAndNext(page);

  await showsQuestion(page, "regions");
  await shot("predict-range-regions", CRITERIA.rangeRegions);
  await submitAndNext(page);

  await showsQuestion(page, "size");
  await shot("predict-hand-size", CRITERIA.handSize);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.16 prediction drill screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await predictScreens(page, theme, viewport);
    });
  }
}
