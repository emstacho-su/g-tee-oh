/**
 * The steps of flow 5 (A7 section 5, S28, R3.4, R3.5, ADR 0018), shared by the stack flow and its
 * mock twin (O-298): request coverage for an uncovered spot and see the queue position, with
 * nothing waiting on a solve; then the admin's pause, resume and settings round trip.
 *
 * Mechanism: each step drives /library through its visible controls only. A gap request is timed
 * from the click to the answer on screen and must finish within ANSWER_LIMIT_MS: the api raises a
 * build or records the request and answers at once, so a slow answer means something waited.
 * Since S40 (O-406) /library is one container with a page per section: the gap request runs on
 * Coverage, pause and resume on Builder state and the settings round trip on Builder settings,
 * each reached through the "Library sections" list.
 */
import { expect, type Page } from "@playwright/test";

/** The four filters that name a configuration, by the labels the selects show. */
export interface ConfigFilters {
  readonly format: "online" | "live";
  readonly tableSize: string;
  readonly stakeLabel: string;
  readonly depthLabel: string;
}

/** A gap request answers at once; ten seconds covers a cold CI runner with room to spare. */
export const ANSWER_LIMIT_MS = 10_000;
const LIVE_LIMIT_MS = 20_000;

export async function openLibrary(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await expect(page).toHaveURL(/\/library\/coverage/);
}

export type LibrarySectionName = "Coverage" | "Builder state" | "Builder settings";

/** Opens one page of the library through its section list. */
export async function openLibrarySection(page: Page, name: LibrarySectionName): Promise<void> {
  await page.getByRole("navigation", { name: "Library sections" }).getByRole("link", { name, exact: true }).click();
}

export async function expectLiveUpdates(page: Page): Promise<void> {
  await expect(page.getByTestId("live-status")).toHaveText("Live updates are on.", { timeout: LIVE_LIMIT_MS });
}

export async function chooseConfig(page: Page, filters: ConfigFilters): Promise<void> {
  const group = page.getByRole("group", { name: "Library filters" });
  await group.getByLabel("Format", { exact: true }).selectOption(filters.format);
  await group.getByLabel("Table size", { exact: true }).selectOption(filters.tableSize);
  await group.getByLabel("Stake", { exact: true }).selectOption({ label: filters.stakeLabel });
  await group.getByLabel("Depth", { exact: true }).selectOption({ label: filters.depthLabel });
  await expect(page.getByRole("list", { name: "Pairs" })).toBeVisible();
}

async function timedAnswer(page: Page, send: () => Promise<void>): Promise<string> {
  const started = Date.now();
  await send();
  const result = page.getByTestId("gap-request-result");
  await expect(result).toBeVisible({ timeout: ANSWER_LIMIT_MS });
  expect(Date.now() - started, "the gap request answered at once, nothing waited on a solve").toBeLessThan(ANSWER_LIMIT_MS);
  return (await result.textContent()) ?? "";
}

/** Selects the first pair the library does not hold and requests its preflop; returns the pair. */
export async function requestUncoveredPreflop(page: Page): Promise<string> {
  const cell = page.getByRole("list", { name: "Pairs" }).getByRole("button").filter({ hasText: "Not in the library" }).first();
  const pair = ((await cell.locator("span").first().textContent()) ?? "").trim();
  await cell.click();
  await expect(page.getByText("The preflop solution is not in the library.")).toBeVisible();
  const text = await timedAnswer(page, () => page.getByRole("button", { name: `Request ${pair} preflop` }).click());
  expect(text).toBe(`${pair} preflop: Recorded for the planner. There is no build job for this spot yet, so it has no queue position.`);
  return pair;
}

/** Selects a covered pair, requests one of its queued flops and expects queue position 1. */
export async function requestQueuedFlop(page: Page, pair: string, flop: string): Promise<void> {
  await page.getByRole("list", { name: "Pairs" }).getByRole("button", { name: new RegExp(`^${pair}`) }).click();
  const queue = page.getByRole("table", { name: "Build queue for this pair" });
  await expect(queue.getByRole("rowheader", { name: flop })).toBeVisible();
  const text = await timedAnswer(page, () => queue.getByRole("button", { name: `Request ${flop}` }).click());
  expect(text).toBe(`${pair} on ${flop}: Queued for the builder at position 1.`);
  await expect(queue.getByRole("row").nth(1).getByRole("rowheader")).toHaveText(flop);
}

/** Pause, then resume: the state shown follows each answer. */
export async function pauseThenResume(page: Page): Promise<void> {
  await openLibrarySection(page, "Builder state");
  const state = page.getByTestId("builder-state");
  await expect(state).toBeVisible();
  await page.getByRole("button", { name: "Pause the builder" }).click();
  await expect(state).toHaveText("Paused");
  await page.getByRole("button", { name: "Resume the builder" }).click();
  await expect(state).not.toHaveText("Paused");
  await expect(page.getByRole("button", { name: "Pause the builder" })).toBeVisible();
}

/**
 * Changes the CPU share, saves, reloads, sees it stored, then restores the value in force it
 * found (PR #28 review L8). It runs on the Builder settings page, whose URL a reload keeps. When that value was the builder default, no route can delete the
 * override (the app role has no delete grant on builder_setting, O-241, and the PATCH has no
 * reset), so the restore stores the default's own value: the builder behaves exactly as before,
 * and the field's hint then says "Now <value>" without "(builder default)". The e2e database is
 * fresh on every run (infra/compose/e2e.mjs), so nothing carries over between runs.
 */
export async function settingsRoundTrip(page: Page, newShare: string): Promise<void> {
  await openLibrarySection(page, "Builder settings");
  const field = () => page.getByRole("spinbutton", { name: "CPU share" });
  const original = await field().inputValue();
  expect(original, "the CPU share field shows the value in force").not.toBe("");
  const save = async (value: string) => {
    await field().fill(value);
    await page.getByRole("button", { name: "Save builder settings" }).click();
    await expect(page.getByText("Saved. The builder reads the new settings before its next job.")).toBeVisible();
  };
  await save(newShare);
  await page.reload();
  await expect(field()).toHaveValue(newShare);
  await save(original);
  await page.reload();
  await expect(field()).toHaveValue(original);
}
