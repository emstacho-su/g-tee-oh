/**
 * Screenshot pass of street mode and the covered-part notes for the owner's review
 * (S26, R3.13, R3.14, O-312 to O-314). The shots project serves the harness build with a mocked
 * api over the synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width, each in a fresh browser context. The test builds its
 * own mocked api (auth plus the study, session and library routes): the session route's fixture
 * drills hold the street, full-hand and partly covered drills, so these pictures do not depend on
 * which drills the drill route of mock-app.ts is seeded with. It signs in and captures:
 * - street mode (pause after_mistake, speed fast): the best first action shows the result chip and
 *   continues by itself, so the second decision of the same hand shows with the counter;
 * - after a mistake at the second decision (the reveal pauses) and Next, the next hand at its first
 *   decision with no summary of the last (S40, O-352, O-407: the api logs the ended hand instead);
 * - the covered-part note of a partly covered drill, and the note of a refused uncovered drill.
 * afterAll merges the records into the shared manifest with session S26 and source mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { fixtureSession } from "../../src/fixtures/index.js";
import {
  FIXTURE_PART_COVERED_DRILL_ID,
  FIXTURE_STREET_DRILL_ID,
  FIXTURE_UNCOVERED_DRILL_ID,
  fixturePartCoveredDrill,
  fixtureStreetDrill,
} from "../../src/fixtures/trainer.js";
import { createMockApi, installMockApi } from "../support/mock-api.js";
import { createMockLibraryRoute } from "../support/mock-library.js";
import { createMockSessionRoute } from "../support/mock-sessions.js";
import { mockStudyRoute } from "../support/mock-study.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S40";

const CRITERIA = {
  streetSecond:
    "R3.13 street mode: second decision in one hand after the opponents' three-bet, counter shows Hand 1, decision 2 (the prompt's hand_decision_no, O-335); the best first action continued by itself (O-314)",
  streetNextHand:
    "R3.13 street mode: the next hand opens at Hand 2, decision 1 with no summary of the last hand, which the api logs instead (S40, O-352, O-407)",
  partCovered: "R3.14 covered part: Running on 2 of 3 spots; 1 queued for the builder, with a router link to the library (O-312, review MEDIUM 4)",
  uncovered: "R3.14 uncovered drill: the 422 alert plus the queued count from its pairs_total and pairs_queued, and a router link to the library (O-312, O-318, ADR 0018)",
} as const;

const records: ShotRecord[] = [];

function runPath(drillId: string): string {
  return `/drills/${drillId}/run`;
}

async function startRun(page: Page, drillId: string, name: string): Promise<void> {
  await page.goto(runPath(drillId));
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
}

async function decide(page: Page, action: string): Promise<void> {
  await page.getByRole("button", { name: action, exact: true }).click();
}

async function nextHand(page: Page): Promise<void> {
  await expect(page.getByTestId("feedback-panel")).toBeVisible();
  await page.getByRole("button", { name: /Next hand/ }).click();
}

async function streetHandScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    await page.waitForLoadState("networkidle");
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installMockApi(page, createMockApi({ routes: [mockStudyRoute, createMockSessionRoute(), createMockLibraryRoute({ admin: true })], session: fixtureSession }));
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await startRun(page, FIXTURE_STREET_DRILL_ID, fixtureStreetDrill.name);
  await expect(page.getByTestId("hand-counter")).toHaveText("Hand 1, decision 1");
  await decide(page, "Raise to 2.5bb");
  await expect(page.getByTestId("hand-counter")).toHaveText("Hand 1, decision 2");
  await shot("street-second-decision", CRITERIA.streetSecond);

  await decide(page, "Raise to 22bb");
  await nextHand(page);
  await expect(page.getByTestId("hand-counter")).toHaveText("Hand 2, decision 1");
  await expect(page.getByTestId("hand-summary")).toHaveCount(0);
  await shot("street-next-hand", CRITERIA.streetNextHand);

  await startRun(page, FIXTURE_PART_COVERED_DRILL_ID, fixturePartCoveredDrill.name);
  await expect(page.getByTestId("coverage-note")).toBeVisible();
  await shot("coverage-note-part", CRITERIA.partCovered);

  await startRun(page, FIXTURE_UNCOVERED_DRILL_ID, "A drill the library does not cover");
  await expect(page.getByTestId("no-coverage-note")).toBeVisible();
  await shot("coverage-note-uncovered", CRITERIA.uncovered);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.13 R3.14 street and covered-part screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await streetHandScreens(page, theme, viewport);
    });
  }
}
