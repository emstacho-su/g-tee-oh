/**
 * Flow 3, the study browser against the compose stack and the fixture library (S25, R3.12, A7
 * section 5, O-286, O-287, O-289). Part of the stack project: just e2e and the CI e2e job run it
 * with the e2e owner's credentials (support/owner-credentials.ts); without them it skips, like
 * sign-in.e2e.ts.
 *
 * Mechanism: sign in, open /study from the main navigation, choose the online 6-max 100 bb
 * configuration and BTN against BB in the settings panel and Confirm (S39; the synthetic set,
 * validation/fixtures/library preflop/cfg_6_online_100, seeded by db/migrations seed_catalog),
 * switch the matrix through frequency, EV and range weight, step down the next likely action in
 * the position carousel's drop-down (or the first continuing one when the likeliest ends the
 * solution) and back by pressing the seat that acted, select a cell and see its threshold card,
 * and assert the synthetic banner. The page's node switch lines (console.info,
 * O-287) are collected through page.on("console") and written to test-results/node-switch.json
 * with the count, each time, the median and the 95th percentile; dev-stack numbers for the
 * latency report, never the O-40 guard. With SCREENSHOT_DIR set, each mode, the threshold card
 * and the line step are captured at desktop width in light and dark (the theme is switched
 * through localStorage and a reload, which keeps the URL and so the screen state) and merged
 * into the shared manifest with source "stack".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { THEME_STORAGE_KEY } from "../../src/store/theme-key.js";
import { ownerCredentials } from "../support/owner-credentials.js";
import { mergeShotManifest, shotDirectory, type ShotRecord } from "../support/shot-manifest.js";
import { capture, DESKTOP, THEMES } from "../support/shots.js";
import { signInOnce } from "../support/sign-in-flow.js";

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "R3.12 flow 3 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";
const SESSION = "S25";
const SHOTS_ENABLED = (process.env["SCREENSHOT_DIR"] ?? "") !== "";
const OUT_DIR = shotDirectory();
const RESULTS_FILE = resolve("test-results", "node-switch.json");
const NODE_SWITCH_LINE = /^g-tee-oh node-switch (\d+(?:\.\d+)?) ms (\S+)$/;
/** A pair choice, a step down and a step back: three switches at least. */
const MIN_SWITCHES = 3;
const P95 = 0.95;
const FLOW_TIMEOUT_MS = 180_000;

const CRITERIA = {
  frequency: "R3.12 flow 3 on the stack: study browser in frequency mode over the fixture library (A7 section 5)",
  ev: "R3.12 flow 3 on the stack: EV mode (A7 section 5)",
  weight: "R3.12 flow 3 on the stack: range-weight mode (A7 section 5)",
  threshold: "R3.12 flow 3 on the stack: threshold card for the selected hand (O-286)",
  line: "R3.12 flow 3 on the stack: one step down the line in the position carousel (O-286, O-354)",
} as const;

interface NodeSwitch {
  ms: number;
  line: string;
}

const records: ShotRecord[] = [];

/** Nearest-rank percentile of sorted values (p in 0..1). */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1] ?? null;
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function writeNodeSwitchReport(switches: readonly NodeSwitch[]): string {
  const sorted = switches.map((entry) => entry.ms).sort((left, right) => left - right);
  const report = { count: switches.length, switches, median_ms: median(sorted), p95_ms: percentile(sorted, P95) };
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(RESULTS_FILE, `${JSON.stringify(report, null, 2)}\n`);
  return `node-switch: ${report.count} switches, median ${String(report.median_ms)} ms, p95 ${String(report.p95_ms)} ms (${RESULTS_FILE})`;
}

function matrix(page: Page) {
  return page.getByRole("img", { name: /^Range matrix, / });
}

/** Captures the current screen in each theme, reloading so the app starts in it. */
async function captureThemes(page: Page, screen: string, criterion: string): Promise<void> {
  if (!SHOTS_ENABLED) return;
  for (const theme of THEMES) {
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [THEME_STORAGE_KEY, theme] as const);
    await page.reload();
    await expect(matrix(page)).toBeVisible();
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport: DESKTOP, criterion, source: "stack" }));
  }
}

/** One segmented choice in the settings panel (a Radix radiogroup per field). */
async function choose(page: Page, field: string, name: string | RegExp): Promise<void> {
  await page.getByRole("radiogroup", { name: field }).getByRole("radio", { name }).click();
}

async function chooseSettings(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Study" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Solution browser" })).toBeVisible();
  await choose(page, "Format", "Online");
  await choose(page, "Table size", /^6 players/);
  await choose(page, "Stake", /^online/);
  await choose(page, "Depth", /^100bb/);
  await choose(page, "First to act", /^BTN/);
  await choose(page, "Against", /^BB/);
  await expect(matrix(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(matrix(page)).toHaveAccessibleName(/frequency mode/);
}

async function switchModes(page: Page): Promise<void> {
  await captureThemes(page, "flow3-study-frequency", CRITERIA.frequency);
  await page.getByRole("radio", { name: "EV" }).click();
  await expect(matrix(page)).toHaveAccessibleName(/expected value mode/);
  await captureThemes(page, "flow3-study-ev", CRITERIA.ev);
  await page.getByRole("radio", { name: "Range weight" }).click();
  await expect(matrix(page)).toHaveAccessibleName(/range weight mode/);
  await captureThemes(page, "flow3-study-weight", CRITERIA.weight);
  await page.getByRole("radio", { name: "Frequency" }).click();
}

async function stepDownAndBack(page: Page): Promise<void> {
  const actions = page.getByRole("region", { name: /'s actions$/ });
  const nextLikely = actions.locator('[data-next-likely="true"]');
  const step = (await nextLikely.count()) > 0 ? nextLikely.first() : actions.locator('button:not([aria-disabled="true"])').first();
  await step.click();
  await expect(page).toHaveURL(/[?&]line=/);
  const positions = page.getByRole("list", { name: "Positions" });
  const acted = positions.locator('[data-state="acted"]').first();
  await expect(acted).toBeVisible();
  await expect(matrix(page)).toBeVisible();
  await captureThemes(page, "flow3-study-line-step", CRITERIA.line);
  await acted.click();
  await expect(page).not.toHaveURL(/[?&]line=/);
  await expect(matrix(page)).toBeVisible();
}

async function selectHand(page: Page): Promise<void> {
  await page.getByRole("group", { name: /Range matrix cells/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]hand=AA/);
  await expect(page.getByTestId("threshold-card")).toBeVisible();
  await captureThemes(page, "flow3-study-threshold-card", CRITERIA.threshold);
}

test.afterAll(() => {
  if (records.length > 0) mergeShotManifest(OUT_DIR, SESSION, records);
});

test("R3.12 flow 3: study browser over the fixture library, node switch times logged", async ({ page }) => {
  test.skip(credentials === undefined, SKIP_REASON);
  if (credentials === undefined) return;
  test.setTimeout(FLOW_TIMEOUT_MS);
  const switches: NodeSwitch[] = [];
  page.on("console", (message) => {
    const match = message.type() === "info" ? NODE_SWITCH_LINE.exec(message.text()) : null;
    if (match !== null) switches.push({ ms: Number(match[1]), line: match[2] ?? "" });
  });
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });

  await signInOnce(page, credentials);
  await chooseSettings(page);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible();
  await switchModes(page);
  await stepDownAndBack(page);
  await selectHand(page);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible();

  await expect.poll(() => switches.length).toBeGreaterThanOrEqual(MIN_SWITCHES);
  console.info(writeNodeSwitchReport(switches));
});
