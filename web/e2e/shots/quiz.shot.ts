/**
 * Screenshot pass of the quizzes for the owner's review (S41, R3.16, O-350, O-410, O-412, O-414,
 * O-419; replaces the S27 predict shots). The shots project serves the harness build with the
 * mocked app api (support/mock-app.ts, with mock-prediction.ts and mock-quiz.ts answering the
 * catalog-spot quiz, its prompts, answers with their reasons and the end, O-264), so the pictures
 * show the synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width, each in a fresh browser context. The test signs in,
 * opens /quiz and fills the start screen (BB, Facing an open, both question kinds, Easy), then
 * walks the Easy quiz: the range yes or no prompt, its result with the passed mark, the hand action
 * prompt with its reason typed, its result and Previous's read-only review, and End quiz. It then
 * opens a Medium and a Hard quiz by address for the other four answer kinds (an address only fills
 * the start screen, so each presses Start quiz, PR #39 security LOW 2), and a Hard quiz on hand
 * questions only, which the mocked api answers with no-quiz-questions. afterAll merges the
 * records into the shared manifest with session S41 and source mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { fixturePredictionPrompt } from "../../src/fixtures/prediction.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S41";
const SUBMIT = "Submit answer";
const NEXT = "Next question";
const REASON_LABEL = "Your reason (required)";
const QUIZ_ADDRESS = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&";

const CRITERIA = {
  start:
    "R3.16 quiz start screen: table select, positions with uncovered seats disabled and named, spot types, question kinds, difficulty with one line per level, Start quiz (O-350, O-410, O-411, O-416)",
  rangeYesNo: "R3.16 Easy range question: over or under a share against a threshold, the required reason field with its count, synthetic banner, no strategy before the answer (O-301, O-412)",
  handAction: "R3.16 Easy hand question: the highest-EV action as the node's tree actions with swatches, a reason typed with its live count (O-379, O-412, ADR 0020)",
  rangePercent: "R3.16 Medium range question: the share to the nearest 5 percent in a number field (O-301, O-410)",
  handBand: "R3.16 Medium hand question: the frequency band of the hand's most frequent action (O-301, O-410)",
  rangeRegions: "R3.16 Hard range question: which named hand regions hold a mixed class, as checkboxes, with Hard named beside the level badge (O-301, O-410)",
  handSize: "R3.16 Hard hand question: the raise size played most, over the aggressive actions only (O-301, O-410)",
  result: "R3.16 quiz result: correct as word and symbol, the solver's answer, Passed Easy at this spot, the window count, no unlock wording, unrated (O-410)",
  previous: "R3.16 Previous: a read-only review of an earlier answer with its reason as text and its reveal, Previous, Newer and Back to current question (O-414)",
  noQuestions:
    "R3.16 no question left: a Hard quiz on hand questions only says No more Hard hand questions in these spots, in its own words, with End quiz and Back to the start screen (O-411 amended)",
} as const;

const records: ShotRecord[] = [];

async function showsQuestion(page: Page, kind: Parameters<typeof fixturePredictionPrompt>[0]): Promise<void> {
  await expect(page.getByRole("heading", { name: fixturePredictionPrompt(kind).question })).toBeVisible();
}

async function typeReason(page: Page, reason: string): Promise<void> {
  await page.getByRole("textbox", { name: REASON_LABEL }).fill(reason);
}

async function submitAndNext(page: Page, reason: string): Promise<void> {
  await typeReason(page, reason);
  await page.getByRole("button", { name: SUBMIT }).click();
  await expect(page.getByTestId("prediction-result")).toBeVisible();
  await page.getByRole("button", { name: NEXT }).click();
}

/** Opens a quiz address, which only fills the start screen (PR #39 security LOW 2), and presses Start quiz. */
async function startByAddress(page: Page, choice: string): Promise<void> {
  await page.goto(`${QUIZ_ADDRESS}${choice}`);
  const start = page.getByRole("button", { name: "Start quiz" });
  await expect(start).toBeEnabled();
  await start.click();
}

async function fillStart(page: Page): Promise<void> {
  const positions = page.getByRole("group", { name: "Positions" });
  await expect(positions.getByRole("button", { name: "BB" })).toBeEnabled();
  await positions.getByRole("button", { name: "BB" }).click();
  await page.getByRole("button", { name: "Facing an open" }).click();
  await page.getByRole("button", { name: "Range questions" }).click();
  await page.getByRole("button", { name: "Hand questions" }).click();
}

async function easyQuiz(page: Page, shot: (screen: string, criterion: string) => Promise<void>): Promise<void> {
  await page.goto("/quiz");
  await expect(page.getByRole("combobox", { name: "Table" })).toBeVisible();
  await fillStart(page);
  await shot("quiz-start", CRITERIA.start);
  await page.getByRole("button", { name: "Start quiz" }).click();

  await showsQuestion(page, "yes_no");
  await shot("quiz-range-yes-no", CRITERIA.rangeYesNo);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await typeReason(page, "Facing a small open from the button, the big blind defends wide.");
  await page.getByRole("button", { name: SUBMIT }).click();
  await expect(page.getByTestId("level-passed")).toBeVisible();
  await shot("quiz-result", CRITERIA.result);
  await page.getByRole("button", { name: NEXT }).click();

  await showsQuestion(page, "action");
  await page.getByRole("button", { name: /Raise to 10bb/ }).click();
  await typeReason(page, "A5s blocks the strongest aces and plays well as a three-bet.");
  await shot("quiz-hand-action", CRITERIA.handAction);
  await page.getByRole("button", { name: SUBMIT }).click();
  await expect(page.getByTestId("prediction-result")).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByTestId("answer-review")).toBeVisible();
  await shot("quiz-previous", CRITERIA.previous);
  await page.getByRole("button", { name: "Back to current question" }).click();
  await page.getByRole("button", { name: "End quiz" }).click();
  await expect(page.getByRole("combobox", { name: "Table" })).toBeVisible();
}

async function quizScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await easyQuiz(page, shot);

  await startByAddress(page, "kinds=range,hand&difficulty=medium");
  await showsQuestion(page, "percent");
  await shot("quiz-range-percent", CRITERIA.rangePercent);
  await page.getByRole("spinbutton").fill("40");
  await submitAndNext(page, "About two in five hands continue.");
  await showsQuestion(page, "band");
  await shot("quiz-hand-band", CRITERIA.handBand);

  await startByAddress(page, "kinds=range,hand&difficulty=hard");
  await showsQuestion(page, "regions");
  await expect(page.getByTestId("difficulty-badge")).toHaveText("Hard");
  await shot("quiz-range-regions", CRITERIA.rangeRegions);
  await submitAndNext(page, "Pairs and suited hands mix the most.");
  await showsQuestion(page, "size");
  await shot("quiz-hand-size", CRITERIA.handSize);

  // The mocked api has no Hard hand question in these spots (mock-quiz.ts), so the start answers 422.
  await startByAddress(page, "kinds=hand&difficulty=hard");
  await expect(page.getByTestId("no-quiz-questions")).toBeVisible();
  await shot("quiz-no-questions", CRITERIA.noQuestions);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.16 quiz screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await quizScreens(page, theme, viewport);
    });
  }
}
