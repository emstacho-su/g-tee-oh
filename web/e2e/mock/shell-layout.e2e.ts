/**
 * The shell's layout in a real browser (S36 review, R3.13, R4.12), in the mock project so CI's e2e
 * job checks it every run: an open dialog stacks above the sticky header on a short viewport, so
 * the header never covers its title or Close button; from md up every Main navigation link stays
 * reachable on a short viewport (the sticky nav scrolls inside); and home never scrolls sideways at
 * 390 px. jsdom has no layout, so these live here rather than in vitest.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { installAppMockApi } from "../support/mock-app.js";
import { signIn } from "../support/sign-in-flow.js";

const OWNER = { email: FIXTURE_USER_EMAIL, password: "any-non-empty-password" };
/** A laptop with a docked panel: wide enough for the sidebar, too short for all ten links. */
const SHORT = { width: 1024, height: 450 } as const;
const PHONE = { width: 390, height: 844 } as const;
/** So short (a landscape phone, a docked window) that the centred shortcuts dialog reaches up under the header. */
const VERY_SHORT = { width: 1024, height: 200 } as const;

/** True when the topmost element at the centre of the locator is the locator itself or inside it. */
async function isOnTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && (top === element || element.contains(top));
  });
}

async function signInAt(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await installAppMockApi(page);
  await signIn(page, OWNER);
}

/** The computed z-index of an element as a number (auto counts as 0). */
async function zIndexOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10) || 0);
}

test("R3.13 an open dialog stacks above the sticky header on a short viewport", async ({ page }) => {
  await signInAt(page, VERY_SHORT);
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  const header = page.getByTestId("app-header");
  // The dialog really reaches under the header here, so the stacking order decides who is seen.
  const [dialogBox, headerBox] = await Promise.all([dialog.boundingBox(), header.boundingBox()]);
  expect((dialogBox?.y ?? Number.POSITIVE_INFINITY) < (headerBox?.y ?? 0) + (headerBox?.height ?? 0)).toBe(true);
  // A modal makes the page inert to the pointer (Radix), so elementFromPoint cannot be used; the
  // header, the overlay and the content are all in the root stacking context, so z-index decides.
  const headerLayer = await zIndexOf(header);
  expect(await zIndexOf(page.getByTestId("dialog-overlay"))).toBeGreaterThan(headerLayer);
  expect(await zIndexOf(dialog)).toBeGreaterThan(headerLayer);
});

test("R3.13 every Main navigation link can be reached and seen on a short viewport", async ({ page }) => {
  await signInAt(page, SHORT);
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  const last = links.last();
  await last.focus();
  await expect(last).toBeInViewport();
  expect(await isOnTop(last)).toBe(true);
});

test("R4.12 home never scrolls sideways at 390 px", async ({ page }) => {
  await signInAt(page, PHONE);
  await expect(page.getByTestId("queue-card")).toBeVisible();
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
});
