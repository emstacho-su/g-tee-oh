/**
 * Drill library and builder screenshots for the owner's review (S26, R3.14, O-289, O-310,
 * O-311, O-317; S40, O-404, O-405, screen review rows 37 to 41). The shots project serves the
 * harness build with the mocked api (support/mock-app.ts, whose drill store is
 * support/mock-drills.ts), so the pictures show the synthetic fixture drills only (O-26).
 *
 * Mechanism: one test per theme and width. It signs in and captures the library table filtered
 * by a tag, the same table with a drill selected in its toolbar, that drill's export dialog, the
 * import dialog refusing a code of another version, the builder container on a new drill's first
 * page, the hands page with a manual hand list, the form alert after Save with a page to fix, and
 * the leave guard asking before an unsaved draft is dropped. afterAll merges the records into the
 * shared manifest. The dialogs are shot as elements, the rest as full pages.
 */
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { openBuilderPage } from "../support/flow-2.js";
import { installAppMockApi } from "../support/mock-app.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, prepareShotPage, SHOT_TEST_TIMEOUT_MS, THEMES, VIEWPORTS, type Viewport } from "../support/shots.js";
import { submitLogin } from "../support/sign-in-flow.js";

const OUT_DIR = shotDirectory();
const SESSION = "S40";
const SOURCE = "mock";
const OWNER = { email: FIXTURE_USER_EMAIL, password: "synthetic-password" };
const FILTER_TAG = "synthetic";
/** A code of a version this server does not read, so the import dialog shows the refusal. */
const OTHER_VERSION_CODE = "gteeoh2.eJyrVkrLz1eyUkrKL1KqBQAgYgSn";
const MANUAL_HANDS = ["AA", "AKs", "AQs", "AJs", "KQs", "AKo", "QQ", "JJ", "T9s", "98s", "87s", "76s"];

const CRITERIA = {
  library:
    "R3.14 O-404 drill library filtered by a tag: a compact table with a radio per row, names, spot summaries, stop rules in words, tags and a settings gear per row; at phone width the spot, stop rule and tags fold under the name with no sideways scroll (S40, row 41)",
  selected:
    "R3.14 O-404 a selected drill: its row raised and bold with the radio checked, and the toolbar naming it with Run, Duplicate, Export and Delete (S40, row 41)",
  export: "R3.14 O-310 export dialog: the drill's gteeoh1. code in a read-only mono field on the shared field edge, with Copy as the primary action (S40, row 39)",
  importRefused: "R3.14 O-310 import dialog: a code of another version refused in a bordered block whose first line starts Error: (S40, row 40)",
  builderNew:
    "R3.14 O-405 builder for a new drill: one container with the Drill sections list beside the page (a row at phone width), the Name and tags page and one Save bar (S40, rows 37 and 38)",
  builderManual: "R3.14 O-405 builder Hands page with a manual hand list on the 13 by 13 hand picker (S40, row 37)",
  builderErrors: "R3.14 O-405 Save with an error on another page: the alert links the page to fix and the Drill sections list marks it needs a fix, in words (S40)",
  leaveGuard: "R3.14 O-405 leaving a builder with unsaved edits asks first: Leave without saving? with Leave and Keep editing (S40, PM note 3)",
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

  await page.getByRole("radio", { name: `Select ${fixtureDrill.name}` }).check();
  const toolbar = page.getByRole("group", { name: "Selected drill" });
  await expect(toolbar).toContainText(`Selected: ${fixtureDrill.name}`);
  await shot("drills-library-selected", CRITERIA.selected);

  await toolbar.getByRole("button", { name: `Export ${fixtureDrill.name}` }).click();
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
  await shot("drills-builder-new", CRITERIA.builderNew);

  await openBuilderPage(page, "Seats");
  await page.getByRole("group", { name: "Hero positions" }).getByRole("checkbox", { name: "BTN" }).check();
  await openBuilderPage(page, "Hands");
  await page.getByRole("group", { name: "Hands to train" }).getByRole("radio", { name: "Manual list" }).check();
  const picker = page.getByRole("group", { name: "Hand picker" });
  for (const hand of MANUAL_HANDS) await picker.getByRole("button", { name: hand, exact: true }).click();
  await expect(page.getByTestId("hand-count")).toHaveText(`${MANUAL_HANDS.length} of 169 hands chosen`);
  await picker.scrollIntoViewIfNeeded();
  await shot("drills-builder-manual-hands", CRITERIA.builderManual);

  await openBuilderPage(page, "Game");
  await page.getByLabel("Depths (bb)").fill("100, abc");
  await page.getByRole("button", { name: "Save drill" }).click();
  await expect(page.getByTestId("form-alert").getByRole("link", { name: "Game: 1 field to fix" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Drill sections" }).getByRole("link", { name: "Game, needs a fix" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("drills-builder-errors", CRITERIA.builderErrors);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Drills", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(leave).toBeVisible();
  await shot("drills-leave-guard", CRITERIA.leaveGuard, leave);
  await leave.getByRole("button", { name: "Leave" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Drill library" })).toBeVisible();
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
