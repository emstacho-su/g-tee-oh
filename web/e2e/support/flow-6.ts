/**
 * The steps of flow 6 (S32, R4.12, A7 section 5, O-321), shared by the mock twin
 * (e2e/mock/flow-6-progress.e2e.ts) and the stack flow (e2e/stack/flow-6-progress.e2e.ts): open
 * /progress, check the leak-cost trend rows and their sparklines, check the heat map cells, toggle
 * both table fallbacks and back, and open a drill from a heat map cell. Each step asserts
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

async function toggleTable(page: Page, subject: string, table: Locator, rows: number): Promise<void> {
  await page.getByRole("button", { name: `Show table: ${subject}` }).click();
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(rows);
  await page.getByRole("button", { name: `Show chart: ${subject}` }).click();
  await expect(table).toBeHidden();
}

/** Both table fallbacks list one row per trend row and per heat map cell, then go back to the charts. */
export async function toggleBothTables(page: Page, trendRows: number, heatCells: number): Promise<void> {
  await toggleTable(page, "leak cost trend", page.getByTestId("leak-table"), trendRows);
  await toggleTable(page, "mastery heat map", page.getByTestId("heat-table"), heatCells);
}

/** Clicks a heat map cell and waits for the drill run screen; answers the drill's path. */
export async function openDrillFromCell(page: Page, cell: Locator): Promise<string> {
  await cell.click();
  await expect(page).toHaveURL(DRILL_RUN_PATH, { timeout: OPEN_TIMEOUT_MS });
  return new URL(page.url()).pathname;
}
