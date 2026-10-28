/**
 * Screenshot pass of the feedback panel's insight cards, More info and Ask for the owner's review
 * (S27 lane D, R3.18, R3.19, R3.20, O-305, O-307, O-308, O-266, O-289). The shots project serves
 * the harness build with the mocked app api (support/mock-app.ts, O-264), so the pictures show the
 * synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width, each in a fresh browser context. The test signs in,
 * starts the fixture drill (RNG mode off) and decides a hand (its first action, then Sure) the
 * way trainer.shot.ts reaches the feedback. The mocked Ask status is switched per request by the MOCK_ASK_STATUS_HEADER header,
 * set with page.setExtraHTTPHeaders before each hand, and the status is read again whenever a new
 * feedback panel mounts. Hand one shows flag_off: the panel with its insight cards, the disabled
 * Ask with its reason and the More info dialog. Hand two shows cap_reached. Hand three shows ok:
 * a validated answer, then a question naming MOCK_ASK_WARNING_TRIGGER, whose answer carries the
 * validator warning. afterAll merges the records into the shared manifest with session S27 and
 * source mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import type { AskStatus } from "../../src/contracts.js";
import { EXPLAIN_TEXT } from "../../src/explain/texts.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { installAppMockApi } from "../support/mock-app.js";
import { MOCK_ASK_STATUS_HEADER, MOCK_ASK_WARNING_TRIGGER } from "../support/mock-explain.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S27";
const RUN_PATH = `/drills/${FIXTURE_DRILL_ID}/run`;
const EXPLAINER_NAME = "How RNG mode works";
const NEXT_HAND = "Next hand";
const QUESTION = "Why is raising better than calling here?";
const WARNING_QUESTION = `Give me an ${MOCK_ASK_WARNING_TRIGGER} estimate of the raise's edge.`;

const CRITERIA = {
  cards: "R3.18 feedback panel with the noise flags, threshold card and drift card (O-304)",
  moreInfo: "R3.19 More info dialog: the five template sections as plain text, every number from the solver data (O-309)",
  flagOff: "R3.20 O-305 Ask disabled with the visible reason: Ask is off until a model key is configured",
  cap: "R3.20 O-307 Ask disabled above the monthly cap with the visible reason: This month's Ask budget is used",
  answer: "R3.20 Ask answer as plain text, validated (O-308)",
  warning: "R3.20 O-308 Ask answer the validator could not check, with its warning",
} as const;

const records: ShotRecord[] = [];

/** Closes the RNG explainer if it opened by itself on first use (O-283). */
async function closeExplainerIfOpen(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: EXPLAINER_NAME });
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
}

/** Sets the mocked Ask status for every request that follows. */
async function useAskStatus(page: Page, reason: AskStatus["reason"]): Promise<void> {
  await page.setExtraHTTPHeaders({ [MOCK_ASK_STATUS_HEADER]: reason });
}

/**
 * Decides the current hand with its first action and Sure, then waits for the settled feedback.
 * The first action button must be enabled first, so a hand still loading is never clicked.
 */
async function decideHand(page: Page): Promise<void> {
  await expect(page.getByTestId("feedback-panel")).toHaveCount(0);
  const firstAction = page.getByTestId("action-bar").getByRole("button").first();
  await expect(firstAction).toBeEnabled();
  await firstAction.click();
  await page.getByRole("button", { name: "Sure", exact: true }).click();
  await expect(page.getByTestId("feedback-panel")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function startSession(page: Page): Promise<void> {
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.goto(RUN_PATH);
  await expect(page.getByRole("heading", { name: fixtureDrill.name })).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  await closeExplainerIfOpen(page);
}

async function askAndWait(page: Page, question: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: EXPLAIN_TEXT.askTitle });
  await dialog.getByRole("textbox", { name: EXPLAIN_TEXT.questionLabel }).fill(question);
  await dialog.getByRole("button", { name: EXPLAIN_TEXT.send }).click();
  await expect(dialog.getByTestId("ask-answer-text")).toBeVisible();
}

async function explainScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (target: Page | Locator, screen: string, criterion: string) => {
    records.push(await capture(target, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  const panel = page.getByTestId("feedback-panel");
  const reason = page.getByTestId("ask-unavailable-reason");

  await useAskStatus(page, "flag_off");
  await startSession(page);
  await decideHand(page);
  await shot(panel, "feedback-cards", CRITERIA.cards);
  await expect(reason).toHaveText(EXPLAIN_TEXT.flagOff);
  await shot(panel, "ask-disabled-flag-off", CRITERIA.flagOff);
  await page.getByRole("button", { name: EXPLAIN_TEXT.moreInfo }).click();
  const moreInfo = page.getByRole("dialog", { name: EXPLAIN_TEXT.moreInfoTitle });
  await expect(moreInfo.getByTestId("more-info-sections")).toBeVisible();
  await shot(page, "feedback-more-info", CRITERIA.moreInfo);
  await page.keyboard.press("Escape");
  await expect(moreInfo).toBeHidden();

  await useAskStatus(page, "cap_reached");
  await page.getByRole("button", { name: NEXT_HAND }).click();
  await decideHand(page);
  await expect(reason).toHaveText(EXPLAIN_TEXT.capReached);
  await shot(panel, "ask-disabled-cap", CRITERIA.cap);

  await useAskStatus(page, "ok");
  await page.getByRole("button", { name: NEXT_HAND }).click();
  await decideHand(page);
  await page.getByTestId("ask-available").click();
  await askAndWait(page, QUESTION);
  await shot(page, "ask-answer", CRITERIA.answer);
  await askAndWait(page, WARNING_QUESTION);
  await expect(page.getByTestId("ask-warning")).toBeVisible();
  await shot(page, "ask-answer-warning", CRITERIA.warning);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.18 R3.19 R3.20 explain screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await explainScreens(page, theme, viewport);
    });
  }
}
