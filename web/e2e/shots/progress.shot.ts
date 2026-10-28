/**
 * /progress screenshots for the owner's review (S32, R4.12, O-320, O-321, O-277, O-289). The shots
 * project serves the harness build with the mocked api (support/mock-app.ts), so the pictures show
 * the synthetic fixtures of src/fixtures/progress.ts only (O-26).
 *
 * Mechanism: one test per theme and width (1440 and 390). The seasoned learner's test captures
 * /progress full page, then element shots of the leak-cost trend, the mastery heat map, the heat
 * map with the tooltip of a focused cell, the holdout card with its Goodhart flag, and both table
 * fallbacks. A second test per theme and width captures the fresh learner's /progress (createApp
 * MockApi learner "fresh") for the empty states. afterAll merges the records into the manifest;
 * each record's criterion names what it proves.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { installAppMockApi } from "../support/mock-app.js";
import type { MockLearner } from "../support/mock-progress.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S32";
const SOURCE = "mock";
const OWNER = { email: FIXTURE_USER_EMAIL, password: "synthetic-password" };
/** A practiced, due class in the middle of the grid, so its tooltip sits inside the card. */
const TOOLTIP_CELL = /^facing-open BB-CO, online 100 bb:/;

const CRITERIA = {
  tracks: "R4.12 track breakdown: each track rating as a dot with its deviation whisker on one shared axis with tier floors, weight and rated decisions in words, a track with no coverage dimmed and named (O-320)",
  page: "R4.12 /progress: rating with deviation and tier, streak, track breakdown, leak-cost trend, mastery heat map and holdout card (06 section 7, A7 section 3)",
  trend: "R4.12 leak-cost trend: top 10 classes weekly on one shared scale, the partial week hollow, a gap for a missing week, a drill button per row (O-320, O-321)",
  heatmap: "R4.12 mastery heat map: five-bin ramp with percents, new cells hatched, mastered checked, due dots and recall bars, legend (O-320)",
  tooltip: "R4.12 heat map tooltip on a focused cell: class, known, recall, attempts, mastered and due (A7 section 4)",
  holdout: "R4.12 holdout card: open round progress and the latest closed round per track with the Goodhart flag in words (O-277)",
  trendTable: "R4.12 leak-cost trend table fallback: the same values week by week, the partial week named (A7 section 4)",
  heatTable: "R4.12 heat map table fallback: every class with known, recall, attempts, mastered and due (A7 section 4)",
  fresh: "R4.12 /progress for a fresh learner: unrated, no leaks yet, every class new, no holdout round yet (empty states)",
} as const;

const records: ShotRecord[] = [];

function shooter(page: Page, theme: Theme, viewport: Viewport) {
  return async (screen: string, criterion: string, target: Parameters<typeof capture>[0] = page) => {
    records.push(await capture(target, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
}

async function openProgress(page: Page, learner: MockLearner): Promise<void> {
  await installAppMockApi(page, { learner });
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.goto("/progress");
  await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
  await expect(page.getByTestId("heat-cell").first()).toBeVisible();
  await expect(page.getByTestId("holdout-card")).toBeVisible();
}

async function chartShots(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  const trend = page.getByTestId("leak-trend");
  const heatmap = page.getByTestId("mastery-heatmap");
  await expect(page.getByTestId("leak-row")).toHaveCount(10);
  await shot("progress-page", CRITERIA.page);
  await shot("progress-tracks", CRITERIA.tracks, page.getByTestId("track-breakdown"));
  await shot("progress-leak-trend", CRITERIA.trend, trend);
  await shot("progress-heatmap", CRITERIA.heatmap, heatmap);

  const grid = page.getByTestId("heat-grid");
  await grid.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: TOOLTIP_CELL }).focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await shot("progress-heatmap-tooltip", CRITERIA.tooltip, grid);
  await page.getByRole("button", { name: TOOLTIP_CELL }).blur();

  await expect(page.getByTestId("goodhart-flag")).toBeVisible();
  await shot("progress-holdout", CRITERIA.holdout, page.getByTestId("holdout-card"));

  await page.getByRole("button", { name: "Show table: leak cost trend" }).click();
  await expect(page.getByTestId("leak-table")).toBeVisible();
  await shot("progress-leak-table", CRITERIA.trendTable, trend);
  await page.getByRole("button", { name: "Show table: mastery heat map" }).click();
  await expect(page.getByTestId("heat-table")).toBeVisible();
  await shot("progress-heatmap-table", CRITERIA.heatTable, heatmap);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R4.12 progress screenshots, seasoned learner, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await openProgress(page, "seasoned");
      await chartShots(page, shooter(page, theme, viewport));
    });

    test(`R4.12 progress screenshot, fresh learner, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await openProgress(page, "fresh");
      await expect(page.getByText("No leaks yet: finish an automated session to see where you lose the most")).toBeVisible();
      await expect(page.getByText("No holdout round yet")).toBeVisible();
      await shooter(page, theme, viewport)("progress-fresh", CRITERIA.fresh);
    });
  }
}
