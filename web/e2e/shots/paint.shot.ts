/**
 * Screenshot pass of range painting for the owner's review (S27 lane B, R3.17, O-300, O-302). The
 * shots project serves the harness build with the mocked app api (support/mock-app.ts, with
 * support/mock-paint.ts answering the drill list, the range_paint session and the paint routes,
 * O-264), so the pictures show the synthetic fixtures only (O-26).
 *
 * Mechanism: one test per theme and width. The test signs in, opens /paint and captures the drill
 * picker, the blank painter (every held class on the fold brush, the classes the node lacks marked
 * not in range), the painter after a few strokes (the raise brush picked with its number key and
 * clicked onto two cells, the call brush dragged along a row), and the graded view after Submit
 * (total, shading legend, costliest classes). afterAll merges the records into the shared manifest
 * with session S27 and source mock.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { fixturePaintDrill } from "../../src/fixtures/paint.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const OWNER = { email: "owner@example.com", password: "synthetic-password" };
const SOURCE = "mock";
const SESSION = "S27";
const DRAG_START = "KK";
const DRAG_REST = ["KQs", "KJs", "KTs"] as const;
const DRAG_END = "KTs";
const CALL_KEY = "2";
const RAISE_KEY = "3";

const CRITERIA = {
  picker: "R3.17 drill picker: the user's drills and Start painting, a drill-backed range_paint session (O-302)",
  blank: "R3.17 blank painter: 13 by 13 grid, one brush per node action with pattern and label, every held class on fold, out-of-range cells disabled (O-300)",
  painted: "R3.17 painted range: click, drag and number-key brushes; color never the only signal (A7 section 4)",
  graded: "R3.17 graded range: per-class painted and solver action, loss shading with a legend, total weighted EV loss and costliest classes from solver-query's grade-range (O-300, ADR 0004)",
} as const;

const records: ShotRecord[] = [];

function cell(page: Page, hand: string) {
  return page.getByRole("button", { name: new RegExp(`^${hand}: `) });
}

async function paintStrokes(page: Page): Promise<void> {
  await page.keyboard.press(RAISE_KEY);
  await cell(page, "AA").click();
  await cell(page, "AKs").click();
  await page.keyboard.press(CALL_KEY);
  await cell(page, DRAG_START).hover();
  await page.mouse.down();
  for (const hand of DRAG_REST) {
    await cell(page, hand).hover();
  }
  await page.mouse.up();
  await expect(cell(page, DRAG_END)).toHaveAccessibleName(/: Call$/);
}

async function paintScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  const shot = async (screen: string, criterion: string) => {
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto("/paint");
  await page.getByRole("radio", { name: fixturePaintDrill.name }).check();
  await shot("paint-picker", CRITERIA.picker);

  await page.getByRole("button", { name: "Start painting" }).click();
  await expect(page.getByTestId("range-painter")).toBeVisible();
  await shot("paint-blank", CRITERIA.blank);

  await paintStrokes(page);
  await shot("paint-painted", CRITERIA.painted);

  await page.getByRole("button", { name: "Submit range" }).click();
  await expect(page.getByTestId("paint-graded")).toBeVisible();
  await shot("paint-graded", CRITERIA.graded);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.17 range painting screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await paintScreens(page, theme, viewport);
    });
  }
}
