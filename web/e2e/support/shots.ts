/**
 * Shared screenshot helpers for the shots files and the stack flows (S24, S25, O-266, O-289).
 *
 * Mechanism: prepareShotPage sets the viewport, reduced motion and the color scheme, and stores
 * the theme before any page script runs (localStorage "gto-theme"), so the app starts in it.
 * capture parks the pointer, waits two animation frames so a canvas matrix has drawn, saves
 * <screen>-<theme>-<width label>.png into the shot folder and returns the manifest record. Each
 * file collects its records and merges them with mergeShotManifest in afterAll.
 */
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { THEME_STORAGE_KEY } from "../../src/store/theme.js";
import type { ShotRecord, ShotSource, Theme } from "./shot-manifest.js";

export interface Viewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const THEMES: readonly Theme[] = ["light", "dark"];
export const DESKTOP: Viewport = { label: "desktop", width: 1440, height: 900 };
export const PHONE: Viewport = { label: "phone", width: 390, height: 844 };
/** Desktop is the product target (01 section 2); the phone width is a sanity view (O-266). */
export const VIEWPORTS: readonly Viewport[] = [DESKTOP, PHONE];
export const SHOT_TEST_TIMEOUT_MS = 180_000;

export async function prepareShotPage(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

export interface ShotSpec {
  readonly screen: string;
  readonly theme: Theme;
  readonly viewport: Viewport;
  readonly criterion: string;
  readonly source: ShotSource;
}

/** Saves a full-page shot of a page, or a shot of one element, and returns its manifest record. */
export async function capture(
  target: Page | Locator,
  page: Page,
  directory: string,
  shot: ShotSpec,
): Promise<ShotRecord> {
  // Park the pointer in the corner so no button is caught in its hover state.
  await page.mouse.move(0, 0);
  await settle(page);
  const file = join(directory, `${shot.screen}-${shot.theme}-${shot.viewport.label}.png`);
  if ("goto" in target) await target.screenshot({ path: file, fullPage: true });
  else await target.screenshot({ path: file });
  return {
    screen: shot.screen,
    theme: shot.theme,
    width: shot.viewport.width,
    height: shot.viewport.height,
    file,
    criterion: shot.criterion,
    source: shot.source,
  };
}
