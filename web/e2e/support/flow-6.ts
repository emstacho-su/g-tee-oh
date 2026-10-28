/**
 * The steps of flow 6 (S32, R4.12, A7 section 5, O-321), shared by the mock twin
 * (e2e/mock/flow-6-progress.e2e.ts) and the stack flow (e2e/stack/flow-6-progress.e2e.ts): open
 * /progress, check the leak-cost trend rows and their sparklines, check the heat map cells, check
 * one accessible representation per chart (S36, O-347: no visible toggle, no second table), and
 * open a drill from a heat map cell. Each step asserts
 * structure; the callers add the exact counts the mocked fixtures allow.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const PROGRESS_PATH = "/progress";
/** /drills/<uuid>/run, the drill run screen a click to drill lands on. */
export const DRILL_RUN_PATH = /\/drills\/[0-9a-f-]{36}\/run$/;
const OPEN_TIMEOUT_MS = 15_000;

export async function openProgress(page: Page): Promise<void> {
  await page.goto(PROGRESS_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
}

/** Waits for the trend's rows and checks every row carries a sparkline; answers the row count. */
export async function expectTrendRows(page: Page): Promise<number> {
  const rows = page.getByTestId("leak-row");
  await expect(rows.first()).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  const count = await rows.count();
  await expect(page.getByTestId("leak-trend").getByTestId("leak-sparkline")).toHaveCount(count);
  return count;
}

/** Waits for the heat map's cells; answers the cell count. */
export async function expectHeatCells(page: Page): Promise<number> {
  const cells = page.getByTestId("heat-cell");
  await expect(cells.first()).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
  return cells.count();
}

/**
 * One accessible representation per chart and no visible table toggle (S36 review, O-347): every
 * trend row's sparkline is named with its weekly values, every heat map cell button is named with
 * its values, and no second table repeats them.
 */
export async function expectAccessibleCharts(page: Page, trendRows: number, heatCells: number): Promise<void> {
  await expect(page.getByRole("button", { name: /^Show (table|chart)/ })).toHaveCount(0);
  await expect(page.getByTestId("leak-table")).toHaveCount(0);
  await expect(page.getByTestId("heat-table")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /: (Week of|.*this week \(partial\))/ })).toHaveCount(trendRows);
  await expect(page.getByTestId("heat-cell").and(page.getByRole("button", { name: /Due for review: (yes|no)$/ }))).toHaveCount(heatCells);
}

/** Clicks a heat map cell and waits for the drill run screen; answers the drill's path. */
export async function openDrillFromCell(page: Page, cell: Locator): Promise<string> {
  await cell.click();
  await expect(page).toHaveURL(DRILL_RUN_PATH, { timeout: OPEN_TIMEOUT_MS });
  return new URL(page.url()).pathname;
}
