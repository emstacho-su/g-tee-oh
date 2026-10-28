/**
 * Home and settings screenshots for the owner's review (S32, R4.12, R4.14, O-322, O-323, O-327).
 * The shots project serves the harness build with the mocked api (support/mock-app.ts), so the
 * pictures show the synthetic progress fixtures of src/fixtures/progress.ts only (O-26).
 *
 * Mechanism: one test per theme and width for the seasoned learner. An init script stores
 * equipped cosmetics under "gto-cosmetics" before any page script runs (as prepareShotPage stores
 * the theme): the 14-day card back, the Tier III felt and the seven-day badge, all unlocked in
 * the fixture. The test captures / (queue, streak, rating with the badge pill) and /settings
 * (session defaults, cosmetics with the card back and felt equipped, hotkeys). A second test per
 * theme and width captures / for a fresh learner (createAppMockApi learner "fresh").
 * afterAll merges the records into the shared manifest.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { COSMETICS_STORAGE_KEY } from "../../src/store/preference-keys.js";
import type { MockLearner } from "../support/mock-progress.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S32";
const SOURCE = "mock";
const OWNER = { email: FIXTURE_USER_EMAIL, password: "synthetic-password" };
const EQUIPPED = { "card-back": "card-back-streak-14", felt: "felt-tier-III", badge: "badge-streak-7" } as const;

const CRITERIA = {
  home: "R4.12 home: today's queue with due and new counts, top 3 leaks and Start training; streak tile; rating card with the equipped badge pill and Open progress (O-322, O-323)",
  homeFresh: "R4.12 home for a fresh learner: nothing due, every class new, no leaks yet, Unrated rating, zero-day streak (O-322)",
  settings: "R4.12 /settings: builder schedule, session defaults (grouping, RNG, configuration scope), cosmetics and read-only hotkeys (O-323, O-327)",
  cosmetics: "R4.14 cosmetics: unlocked items selectable, locked items named with their unlock rule, card back and felt equipped with previews (O-323)",
  hotkeys: "O-327 hotkeys: the trainer and app shortcuts listed read only, rebinding noted as later",
} as const;

const records: ShotRecord[] = [];

function shooter(page: Page, theme: Theme, viewport: Viewport) {
  return async (screen: string, criterion: string, target: Page | ReturnType<Page["locator"]> = page) => {
    records.push(await capture(target, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
}

async function equipCosmetics(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [COSMETICS_STORAGE_KEY, JSON.stringify(EQUIPPED)] as const,
  );
}

async function signIn(page: Page, learner: MockLearner): Promise<void> {
  await installAppMockApi(page, { learner });
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R4.12 R4.14 home and settings screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await equipCosmetics(page);
      await signIn(page, "seasoned");
      const shot = shooter(page, theme, viewport);

      await expect(page.getByTestId("queue-due")).toBeVisible();
      await expect(page.getByTestId("badge-pill")).toHaveText(/Seven-day streak badge/);
      await expect(page.getByTestId("streak-current")).toBeVisible();
      await shot("home", CRITERIA.home);

      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
      await expect(page.getByRole("form", { name: "Builder schedule" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Card back" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-felt", EQUIPPED.felt);
      await shot("settings", CRITERIA.settings);

      const cosmetics = page.getByRole("region", { name: "Cosmetics" });
      await expect(cosmetics.getByRole("radio", { name: /Fourteen-day streak card back/ })).toBeChecked();
      await expect(cosmetics.getByRole("radio", { name: /Tier III felt/ })).toBeChecked();
      await cosmetics.scrollIntoViewIfNeeded();
      await shot("settings-cosmetics", CRITERIA.cosmetics, cosmetics);

      const hotkeys = page.getByRole("region", { name: "Hotkeys" });
      await hotkeys.scrollIntoViewIfNeeded();
      await shot("settings-hotkeys", CRITERIA.hotkeys, hotkeys);
    });

    test(`R4.12 home screenshot, fresh learner, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await signIn(page, "fresh");
      await expect(page.getByTestId("queue-due")).toHaveText("Nothing due for review now.");
      await expect(page.getByTestId("rating-value")).toHaveText("Unrated");
      await shooter(page, theme, viewport)("home-fresh", CRITERIA.homeFresh);
    });
  }
}
