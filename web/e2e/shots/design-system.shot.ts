/**
 * Design system screenshots for the owner's review (S36, R3.13, O-346, O-364). The shots project
 * serves the harness build; the gallery's design sections (src/gallery/design-sections.tsx) show
 * the palette, the tokens, every Button and the controls in each theme and width.
 *
 * Mechanism: one test per theme and width captures the three design sections at rest, then holds
 * the primary "Press and hold" button down with the mouse twice: once with motion allowed, where
 * the button squishes (its rendered box gets wider and shorter), and once under reduced motion,
 * where it does not move and only the shadow shows the press. Both times the test measures the two
 * neighbouring buttons before and while pressed and asserts they did not move, which proves the
 * squish is transform only and shifts no layout. The pressed shots are taken directly (capture()
 * parks the pointer, which would end the hover state), with the same record shape.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, settle, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";

const OUT_DIR = shotDirectory();
const SESSION = "S36";
const SOURCE = "mock";
/** The spring curve takes 220 ms; wait past it before measuring or shooting the pressed state. */
const PRESS_SETTLE_MS = 300;

const CRITERIA = {
  tokens: "R3.13 O-346 the owner's palette (8c1c13, bf4342, e7d7c1, a78a7f, 735751) and the semantic tokens built from it in this theme",
  buttons: "R3.13 O-346 every Button variant and size, disabled included, on the shared tactile press with soft layered depth",
  controls: "R3.13 O-346 segmented control, native checkbox and radio on the accent, and a raised Card with every text colour",
  pressed: "R3.13 O-364 a held primary button squishes wider and shorter and sinks, and its neighbours do not move (transform only)",
  pressedReduced: "R3.13 O-364 under reduced motion a held button does not move; only the inset shadow shows the press",
} as const;

const records: ShotRecord[] = [];

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("design-system shots: an element has no box");
  return box;
}

/** Holds the target down, checks the neighbours stay put, shoots the row, then releases. */
async function pressAndShoot(page: Page, theme: Theme, viewport: Viewport, screen: string, criterion: string): Promise<Box> {
  const row = page.getByTestId("press-row");
  const target = page.getByTestId("press-target");
  const neighbours = [page.getByTestId("press-neighbour-before"), page.getByTestId("press-neighbour-after")];
  await row.scrollIntoViewIfNeeded();
  const before = await Promise.all(neighbours.map(boxOf));
  const rest = await boxOf(target);
  await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await settle(page);
  expect(await Promise.all(neighbours.map(boxOf))).toEqual(before);
  const pressed = await boxOf(target);
  const file = join(OUT_DIR, `${screen}-${theme}-${viewport.label}.png`);
  await row.screenshot({ path: file });
  records.push({ screen, theme, width: viewport.width, height: viewport.height, file, criterion, source: SOURCE });
  await page.mouse.up();
  await page.mouse.move(0, 0);
  return { ...pressed, width: pressed.width - rest.width, height: pressed.height - rest.height };
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.13 design system screenshots and the press, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await page.goto(`/gallery.html?theme=${theme}`);
      // The gallery reads the palette from the loaded styles.css (S36 review): all five appear.
      await expect(page.getByRole("list", { name: "Palette" }).getByRole("listitem")).toHaveCount(5);
      for (const [name, criterion] of [
        ["design-tokens", CRITERIA.tokens],
        ["design-buttons", CRITERIA.buttons],
        ["design-controls", CRITERIA.controls],
      ] as const) {
        const section = page.getByTestId(`gallery-${name}`);
        await section.scrollIntoViewIfNeeded();
        records.push(await capture(section, page, OUT_DIR, { screen: `gallery-${name}`, theme, viewport, criterion, source: SOURCE }));
      }

      // prepareShotPage asks for reduced motion: the press must not move the button at all.
      const still = await pressAndShoot(page, theme, viewport, "design-press-reduced-motion", CRITERIA.pressedReduced);
      expect([still.width, still.height]).toEqual([0, 0]);

      await page.emulateMedia({ reducedMotion: "no-preference" });
      const squish = await pressAndShoot(page, theme, viewport, "design-press", CRITERIA.pressed);
      expect(squish.width).toBeGreaterThan(0);
      expect(squish.height).toBeLessThan(0);
    });
  }
}
