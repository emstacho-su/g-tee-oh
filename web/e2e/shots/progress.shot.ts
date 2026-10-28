/**
 * /progress screenshots for the owner's review (S32, R4.12, O-320, O-321, O-277, O-289). The shots
 * project serves the harness build with the mocked api (support/mock-app.ts), so the pictures show
 * the synthetic fixtures of src/fixtures/progress.ts only (O-26).
 *
 * Mechanism: one test per theme and width (1440 and 390). The seasoned learner's test captures
 * /progress full page, then element shots of the leak-cost trend, the mastery heat map, the heat
 * map with the tooltip of a focused cell, the holdout card with its Goodhart flag and (S41, O-353)
 * the frequency card; the fresh learner's run adds the frequency card's empty state; since S36 the
 * tables are screen-reader only (O-347) and not shot. A second test per theme and width captures
 * the fresh learner's /progress (createAppMockApi learner "fresh") for the empty states. afterAll merges the records into the manifest;
 * each record's criterion names what it proves.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { installAppMockApi } from "../support/mock-app.js";
import type { MockLearner } from "../support/mock-progress.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S36";
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
  fresh: "R4.12 /progress for a fresh learner: unrated, no leaks yet, every class new, no holdout round yet (empty states)",
  frequencies:
    "R4.12 frequency card: a spot select named in words, paired bars per action with your share and the solver's written next to each bar, hand rows largest gap first (O-353, O-417)",
  frequenciesEmpty: "R4.12 frequency card with no spot yet: how many preflop decisions at one spot fill it (O-417)",
} as const;

const records: ShotRecord[] = [];

function shooter(page: Page, theme: Theme, viewport: Viewport) {
  return async (screen: string, criterion: string, target: Parameters<typeof capture>[0] = page) => {
    records.push(await capture(target, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
}

/** Centres a card in the viewport, so the sticky app header does not cover its heading in an element shot. */
async function clearOfHeader(card: Locator): Promise<void> {
  await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
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

  await expect(page.getByTestId("frequency-bars")).toBeVisible();
  await clearOfHeader(page.getByTestId("frequency-card"));
  await shot("progress-frequencies", CRITERIA.frequencies, page.getByTestId("frequency-card"));

  // S36, O-347: no visible table toggle and no table to picture (the old progress-leak-table and
  // progress-heatmap-table shots); the rows and cells carry the values for screen readers.
  await expect(page.getByRole("button", { name: /^Show (table|chart)/ })).toHaveCount(0);
  await expect(page.getByTestId("leak-table")).toHaveCount(0);
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
      await expect(page.getByText("Play 30 preflop decisions at one spot to compare your frequencies with the solver's.")).toBeVisible();
      await clearOfHeader(page.getByTestId("frequency-card"));
      await shooter(page, theme, viewport)("progress-frequencies-empty", CRITERIA.frequenciesEmpty, page.getByTestId("frequency-card"));
    });
  }
}
