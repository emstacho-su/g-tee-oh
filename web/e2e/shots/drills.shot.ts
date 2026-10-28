/**
 * Drill library and builder screenshots for the owner's review (S26, R3.14, O-289, O-310,
 * O-311, O-317). The shots project serves the harness build with the mocked api
 * (support/mock-app.ts, whose drill store is support/mock-drills.ts), so the pictures show the
 * synthetic fixture drills only (O-26).
 *
 * Mechanism: one test per theme and width. It signs in and captures the library filtered by a
 * tag, a drill's export dialog, the import dialog refusing a code of another version, the builder
 * for a new drill, and the builder with a manual hand list on the hand picker. afterAll merges the
 * records into the shared manifest. The two dialogs are shot as elements, the rest as full pages.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S26";
const SOURCE = "mock";
const OWNER = { email: FIXTURE_USER_EMAIL, password: "synthetic-password" };
const FILTER_TAG = "synthetic";
/** A code of a version this server does not read, so the import dialog shows the refusal. */
const OTHER_VERSION_CODE = "gteeoh2.eJyrVkrLz1eyUkrKL1KqBQAgYgSn";
const MANUAL_HANDS = ["AA", "AKs", "AQs", "AJs", "KQs", "AKo", "QQ", "JJ", "T9s", "98s", "87s", "76s"];

const CRITERIA = {
  library: "R3.14 drill library filtered by a tag: names, spot summaries, stop rules in words, tags and per-drill actions",
  export: "R3.14 O-310 export dialog: the drill's gteeoh1. code in a read-only field with Copy",
  importRefused: "R3.14 O-310 import dialog: a code of another version refused with the api's reason",
  builderNew: "R3.14 O-317 builder for a new drill: sections mirroring the schema, v1 notes on fields v1 does not serve",
  builderManual: "R3.14 builder with a manual hand list on the 13 by 13 hand picker",
} as const;

const records: ShotRecord[] = [];

/**
 * Shoots the full page, or one element: a dialog is shot on its own, because a full-page shot
 * stretches the page past the viewport while the dialog's fixed overlay covers only the viewport.
 */
function shooter(page: Page, theme: Theme, viewport: Viewport) {
  return async (screen: string, criterion: string, target: Page | Locator = page) => {
    records.push(await capture(target, page, OUT_DIR, { screen, theme, viewport, criterion, source: SOURCE }));
  };
}

async function signIn(page: Page): Promise<void> {
  await installAppMockApi(page);
  await page.goto("/login");
  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

async function libraryScreens(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  await page.goto(`/drills?tag=${FILTER_TAG}`);
  await expect(page.getByTestId("tag-filter-note")).toContainText(`Showing drills tagged ${FILTER_TAG}.`);
  await expect(page.getByTestId("drill-row").first()).toBeVisible();
  await shot("drills-library-filtered", CRITERIA.library);

  await page.getByRole("button", { name: `Export ${fixtureDrill.name}` }).click();
  const exportDialog = page.getByRole("dialog");
  await expect(exportDialog.getByLabel("Export code")).toHaveValue(/^gteeoh1\./);
  await shot("drills-export-dialog", CRITERIA.export, exportDialog);
  await page.keyboard.press("Escape");
  await expect(exportDialog).toBeHidden();

  await page.getByRole("button", { name: "Import a drill" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import a drill" });
  await importDialog.getByLabel("Export code").fill(OTHER_VERSION_CODE);
  await importDialog.getByRole("button", { name: "Import" }).click();
  await expect(importDialog.getByTestId("import-failure")).toContainText("does not start with gteeoh1.");
  await shot("drills-import-refused", CRITERIA.importRefused, importDialog);
  await page.keyboard.press("Escape");
}

async function builderScreens(page: Page, shot: ReturnType<typeof shooter>): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New drill" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New drill" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("RFI boundary hands");
  await page.getByRole("group", { name: "Hero positions" }).getByRole("checkbox", { name: "BTN" }).check();
  await shot("drills-builder-new", CRITERIA.builderNew);

  await page.getByRole("group", { name: "Hands to train" }).getByRole("radio", { name: "Manual list" }).check();
  const picker = page.getByRole("group", { name: "Hand picker" });
  for (const hand of MANUAL_HANDS) await picker.getByRole("button", { name: hand, exact: true }).click();
  await expect(page.getByTestId("hand-count")).toHaveText(`${MANUAL_HANDS.length} of 169 hands chosen`);
  await picker.scrollIntoViewIfNeeded();
  await shot("drills-builder-manual-hands", CRITERIA.builderManual);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  mergeShotManifest(OUT_DIR, SESSION, records);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.14 drill library and builder screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(SHOT_TEST_TIMEOUT_MS);
      await prepareShotPage(page, theme, viewport);
      await signIn(page);
      const shot = shooter(page, theme, viewport);
      await libraryScreens(page, shot);
      await builderScreens(page, shot);
    });
  }
}
