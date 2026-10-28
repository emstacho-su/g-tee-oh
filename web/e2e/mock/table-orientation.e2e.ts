/**
 * The table turns with its own width (S38, R3.13, O-380): on the drill run, at a 1440 px viewport
 * the poker table's box is wider than tall (landscape, 16 by 9), and at 390 px it is taller than
 * wide (portrait, 4 by 5), with no sideways scroll and every seat card inside the table's box.
 * jsdom cannot evaluate container queries, so this mock-project spec is where the switch is proven
 * in a real browser. The replay is finished first with a click on the table (PM note b).
 */
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "../../src/fixtures/trainer.js";
import { installAppMockApi } from "../support/mock-app.js";
import { signIn } from "../support/sign-in-flow.js";

const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;
const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const RUN_PATH = `/drills/${FIXTURE_DRILL_ID}/run`;
const EXPLAINER_NAME = "How Mixed-frequency mode works";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openTable(page: Page): Promise<void> {
  await installAppMockApi(page);
  await signIn(page, OWNER);
  await page.goto(RUN_PATH);
  await expect(page.getByRole("heading", { name: fixtureDrill.name })).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  const explainer = page.getByRole("dialog", { name: EXPLAINER_NAME });
  if (await explainer.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(explainer).toBeHidden();
  }
  const table = page.getByTestId("poker-table");
  await expect(table).toBeVisible();
  await table.click();
  await expect(table).toHaveAttribute("data-replaying", "false");
}

async function tableBox(page: Page): Promise<Box> {
  const box = await page.getByTestId("poker-table").locator(".table-box").boundingBox();
  if (box === null) throw new Error("table orientation: the table box has no layout box");
  return box;
}

async function expectSeatsInside(page: Page, table: Box): Promise<void> {
  const seats = page.getByTestId(/^seat-/);
  const count = await seats.count();
  expect(count).toBeGreaterThanOrEqual(6);
  for (let index = 0; index < count; index += 1) {
    const seat = await seats.nth(index).boundingBox();
    expect(seat, `seat ${index} has a layout box`).not.toBeNull();
    if (seat === null) continue;
    expect(seat.x).toBeGreaterThanOrEqual(table.x - 1);
    expect(seat.x + seat.width).toBeLessThanOrEqual(table.x + table.width + 1);
  }
}

async function expectNoSidewaysScroll(page: Page, screen: string): Promise<void> {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll, `${screen}: page width ${widths.scroll} px at a ${widths.inner} px viewport`).toBeLessThanOrEqual(widths.inner);
}

test("R3.13 at 1440 px the table is landscape: its box is wider than tall (O-380)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openTable(page);
  const box = await tableBox(page);
  expect(box.width).toBeGreaterThan(box.height);
  await expectSeatsInside(page, box);
  await expectNoSidewaysScroll(page, "landscape table");
});

test("R3.13 at 390 px the table is portrait: its box is taller than wide, with no sideways scroll (O-380)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openTable(page);
  const box = await tableBox(page);
  expect(box.height).toBeGreaterThan(box.width);
  await expectSeatsInside(page, box);
  await expectNoSidewaysScroll(page, "portrait table");
});
