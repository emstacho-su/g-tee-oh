/**
 * Screenshot pass for the owner's review (S24 step 3, O-67, O-266). The shots project serves the
 * harness build (vite preview on 4173, O-267) with the mocked api (O-264), so no Docker is
 * needed and the pictures show synthetic data only (O-26).
 *
 * Mechanism: one test per theme and width. Each test sets the theme before any page script runs
 * (localStorage "gto-theme" for the app, ?theme= for the gallery), emulates reduced motion so no
 * card is caught mid-animation, waits two animation frames after each change so the canvas
 * matrix has drawn, and saves PNGs to SCREENSHOT_DIR (default test-results/shots) as
 * <screen>-<theme>-<width>.png. Every shot is listed in manifest.json beside the PNGs with its
 * screen, theme, width, file path and the handoff acceptance criterion it demonstrates, so the
 * review page can be built without guessing. Desktop is the product target (01 section 2); the
 * phone width is a sanity view only (O-266).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockApi } from "../support/mock-api.js";
import { submitLogin } from "../support/sign-in-flow.js";

type Theme = "light" | "dark";

interface Viewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

interface ShotRecord {
  screen: string;
  theme: Theme;
  width: number;
  height: number;
  file: string;
  criterion: string;
}

const THEMES: readonly Theme[] = ["light", "dark"];
const VIEWPORTS: readonly Viewport[] = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "phone", width: 390, height: 844 },
];
const OUT_DIR = resolve(process.env.SCREENSHOT_DIR ?? "test-results/shots");
const THEME_STORAGE_KEY = "gto-theme";
const OWNER = { email: "owner@example.com", password: "synthetic-password" };

const CRITERIA = {
  login: "Login page renders (DoD 1: login page, home shell and route placeholders render)",
  loginError: "Login shows a generic error and never echoes server detail (step 4, login form)",
  home: "Home shell renders after sign in, the smoke flow's landing page (DoD 1, R3.13)",
  placeholder: "Route placeholders render under the shell (DoD 1, A7 section 2)",
  shortcuts: "Keyboard-first: the ? shortcuts overlay (A7 section 4, R3.13 hotkeys)",
  table: "PokerTable: 6 to 9 seats, stacks, pot, button, bets, straddle marker (R3.13)",
  cards: "CardView and BoardReveal (R3.13)",
  actionBar: "ActionBar: buttons from the node's tree actions, exact size preflop, bucket with size postflop (R3.13, O-22, ADR 0020)",
  confidence: "ConfidenceTap: sure or unsure before the reveal (R3.13)",
  roller: "RngRoller: the roll and the cumulative bands (R3.13, O-213)",
  feedback: "FeedbackPanel shell: label, EV loss in bb and percent pot, the hand's frequencies (R3.13)",
  panels: "ActionFrequencyTable and ThresholdCard (R3.12, R3.13)",
  matrix: "RangeMatrix canvas with per-cell action frequency bars; color never the only signal (R3.12, A7 section 4)",
  matrixEv: "RangeMatrix EV mode (R3.12)",
  matrixWeight: "RangeMatrix range-weight mode (R3.12)",
  matrixTable: "The accessible table fallback renders the same data (DoD 3, R3.12)",
} as const;

const GALLERY_SECTIONS: readonly (readonly [string, string])[] = [
  ["poker-table-6", CRITERIA.table],
  ["poker-table-9", CRITERIA.table],
  ["cards", CRITERIA.cards],
  ["board-reveal", CRITERIA.cards],
  ["action-bar", CRITERIA.actionBar],
  ["confidence-tap", CRITERIA.confidence],
  ["rng-roller", CRITERIA.roller],
  ["feedback-panel", CRITERIA.feedback],
  ["action-frequency-table", CRITERIA.panels],
  ["threshold-card", CRITERIA.panels],
  ["range-matrix-frequency", CRITERIA.matrix],
  ["range-matrix-ev", CRITERIA.matrixEv],
  ["range-matrix-weight", CRITERIA.matrixWeight],
  ["range-matrix-table", CRITERIA.matrixTable],
];

const records: ShotRecord[] = [];

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function capture(
  target: Page | Locator,
  page: Page,
  shot: { screen: string; theme: Theme; viewport: Viewport; criterion: string },
): Promise<void> {
  // Park the pointer in the corner so no button is caught in its hover state.
  await page.mouse.move(0, 0);
  await settle(page);
  const file = join(OUT_DIR, `${shot.screen}-${shot.theme}-${shot.viewport.label}.png`);
  if ("goto" in target) await target.screenshot({ path: file, fullPage: true });
  else await target.screenshot({ path: file });
  records.push({
    screen: shot.screen,
    theme: shot.theme,
    width: shot.viewport.width,
    height: shot.viewport.height,
    file,
    criterion: shot.criterion,
  });
}

async function appScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  await installMockApi(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await capture(page, page, { screen: "login", theme, viewport, criterion: CRITERIA.login });

  await submitLogin(page, { email: "someone-else@example.com", password: "wrong" });
  await expect(page.getByRole("alert")).toBeVisible();
  await capture(page, page, { screen: "login-error", theme, viewport, criterion: CRITERIA.loginError });

  await submitLogin(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await capture(page, page, { screen: "home", theme, viewport, criterion: CRITERIA.home });

  await page.keyboard.press("?");
  const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(overlay).toBeVisible();
  await capture(page, page, { screen: "shortcuts-overlay", theme, viewport, criterion: CRITERIA.shortcuts });
  await page.keyboard.press("Escape");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Study" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await capture(page, page, { screen: "placeholder-study", theme, viewport, criterion: CRITERIA.placeholder });
}

async function galleryScreens(page: Page, theme: Theme, viewport: Viewport): Promise<void> {
  await page.goto(`/gallery.html?theme=${theme}`);
  const tableSection = page.getByTestId("gallery-range-matrix-table");
  await tableSection.getByRole("button", { name: "Show as table" }).click();
  for (const [name, criterion] of GALLERY_SECTIONS) {
    const section = page.getByTestId(`gallery-${name}`);
    await section.scrollIntoViewIfNeeded();
    await capture(section, page, { screen: `gallery-${name}`, theme, viewport, criterion });
  }
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  const manifest = { session: "S24", generated: new Date().toISOString(), directory: OUT_DIR, shots: records };
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
});

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`R3.12 R3.13 screenshots, ${theme} theme, ${viewport.label} width`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        [THEME_STORAGE_KEY, theme] as const,
      );
      await appScreens(page, theme, viewport);
      await galleryScreens(page, theme, viewport);
    });
  }
}
