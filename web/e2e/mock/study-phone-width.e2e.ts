/**
 * The study entry and the position carousel on a 390 px phone (S39, R3.12, O-354). Runs in the
 * mock project against the harness build, so CI's e2e job checks it every run.
 *
 * Checks: the settings panel and the solution never scroll the page sideways (document scrollWidth
 * at most innerWidth); the carousel strip scrolls inside its own box; whenever the line changes
 * the current seat is brought fully into the strip's view; and a keyboard-focused seat's focus
 * ring (outline width plus offset) fits inside the strip, so overflow never clips it.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { FIXTURE_GRANDCHILD_LINE, FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { installAppMockApi } from "../support/mock-app.js";
import { signIn } from "../support/sign-in-flow.js";

const PHONE = { width: 390, height: 844 } as const;
const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
const STUDY_PATH = `/study?format=online&table_size=6&stake=${FIXTURE_ONLINE_STAKE_ID}&depth=10000&pair=${FIXTURE_STUDY_PAIR}`;
/** Sub-pixel rounding allowance when comparing boxes. */
const EPSILON_PX = 1;

async function expectNoSidewaysScroll(page: Page, screen: string): Promise<void> {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll, `${screen}: page width ${widths.scroll} px at a ${widths.inner} px viewport`).toBeLessThanOrEqual(widths.inner);
}

function strip(page: Page): Locator {
  return page.getByTestId("position-strip");
}

function currentSeat(page: Page): Locator {
  return page.getByRole("list", { name: "Positions" }).locator('[aria-current="step"]');
}

/** True when the seat's box lies inside the strip's visible box. */
async function seatInView(page: Page, seat: Locator): Promise<boolean> {
  const [seatBox, stripBox] = await Promise.all([seat.boundingBox(), strip(page).boundingBox()]);
  if (seatBox === null || stripBox === null) return false;
  return seatBox.x >= stripBox.x - EPSILON_PX && seatBox.x + seatBox.width <= stripBox.x + stripBox.width + EPSILON_PX;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installAppMockApi(page);
  await signIn(page, OWNER);
});

test("R3.12 the settings panel fits a 390 px phone", async ({ page }) => {
  await page.goto("/study");
  await expect(page.getByRole("region", { name: "Spot settings" })).toBeVisible();
  await page.getByRole("radio", { name: "Online" }).click();
  await page.getByRole("radiogroup", { name: "Table size" }).getByRole("radio", { name: /^6 players/ }).click();
  await page.getByRole("radiogroup", { name: "Stake" }).getByRole("radio", { name: /^online/ }).click();
  await page.getByRole("radiogroup", { name: "Depth" }).getByRole("radio", { name: /^100bb/ }).click();
  await expect(page.getByRole("radiogroup", { name: "First to act" })).toBeVisible();
  await expectNoSidewaysScroll(page, "settings panel");
});

test("R3.12 the carousel scrolls in its own box and keeps the current seat in view as the line changes", async ({ page }) => {
  await page.goto(STUDY_PATH);
  await expect(page.getByRole("region", { name: "BTN's actions" })).toBeVisible();
  await expectNoSidewaysScroll(page, "study root");
  const overflow = await strip(page).evaluate((box) => box.scrollWidth > box.clientWidth);
  expect(overflow, "six seats overflow the strip at 390 px").toBe(true);
  await expect.poll(() => seatInView(page, currentSeat(page))).toBe(true);

  await page.getByRole("region", { name: "BTN's actions" }).locator('[data-next-likely="true"]').click();
  await expect(page.getByRole("region", { name: "BB's actions" })).toBeVisible();
  await expect(currentSeat(page)).toContainText("BB");
  await expect.poll(() => seatInView(page, currentSeat(page))).toBe(true);
  await expectNoSidewaysScroll(page, "one step down");

  await page.goto(`${STUDY_PATH}&line=${FIXTURE_GRANDCHILD_LINE}`);
  await expect(page.getByRole("list", { name: "Positions" }).getByRole("button")).toHaveCount(7);
  await expect.poll(() => seatInView(page, currentSeat(page))).toBe(true);
  await expectNoSidewaysScroll(page, "reraise line");
});

test("R3.12 a keyboard-focused seat shows its whole focus ring inside the strip", async ({ page }) => {
  await page.goto(STUDY_PATH);
  await expect(page.getByRole("region", { name: "BTN's actions" })).toBeVisible();
  const first = page.getByRole("list", { name: "Positions" }).getByRole("button").first();
  await strip(page).evaluate((box) => box.scrollTo({ left: 0, behavior: "auto" }));
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  const ring = await first.evaluate((button) => {
    const style = getComputedStyle(button);
    const reach = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    const box = button.closest('[data-testid="position-strip"]');
    if (box === null) return null;
    const seat = button.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    return {
      style: style.outlineStyle,
      reach,
      top: seat.top - frame.top,
      bottom: frame.bottom - seat.bottom,
      left: seat.left - frame.left,
    };
  });
  expect(ring).not.toBeNull();
  expect(ring?.style).not.toBe("none");
  expect(ring?.top ?? 0).toBeGreaterThanOrEqual((ring?.reach ?? 0) - EPSILON_PX);
  expect(ring?.bottom ?? 0).toBeGreaterThanOrEqual((ring?.reach ?? 0) - EPSILON_PX);
  expect(ring?.left ?? 0).toBeGreaterThanOrEqual((ring?.reach ?? 0) - EPSILON_PX);
});
