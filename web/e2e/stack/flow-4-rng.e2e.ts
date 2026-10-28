/**
 * Flow 4 (A7 section 5): the trainer in spot mode with RNG mode, on the compose stack with the
 * fixture library (S25, R3.10, R3.11, R3.13, O-282 to O-285, O-288, ADR 0018). Part of the stack
 * project, so just e2e and the CI e2e job run it; without E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD
 * it skips like sign-in.e2e.ts.
 *
 * Mechanism: sign in, then create the drill through the api from the page's own context (the
 * session cookie rides along): GET /api/v1/me for the csrf_token, POST /api/v1/drills with
 * x-csrf-token and an Idempotency-Key, for the synthetic online 6-max 100bb set (stake label
 * "online", the button opening against the big blind, the latency test's filter), grouping
 * grouped, stop rule after_action, RNG off. Open /drills/<id>/run with a fixed seed, so the hand
 * sequence repeats on every run (O-288). Switch RNG mode on: the explainer opens on first use (a
 * fresh browser context has no gto-rng-explainer-seen, O-283); close it, start, reopen it from the
 * roll badge's info control and close it. Then play: before each decision the badge shows a roll
 * and no band strip is on the page (O-282); after choosing an action there is no feedback panel
 * until the confidence tap (R3.11, O-284); after the tap the feedback shows. The first hand whose
 * frequencies mix two or more actions above MIXED_MIN_FREQUENCY must show the roller with the
 * roll-selected action marked Best, and that action must be in best_action_indexes and equal
 * packages/learning's rollSelectedAction over the prompt's buttons (O-213). Other hands go on with
 * N, bounded by MAX_HANDS, after which the flow fails with a clear message rather than looping.
 * Finally E and the confirm end the session and the recap shows.
 *
 * When SCREENSHOT_DIR is set the flow runs once per theme at the desktop width and captures the
 * start panel, the explainer, the prompt with the roll, the tap, the feedback with the roller and
 * the recap, merged into the manifest with session S25 and source stack (O-289). The seed was not
 * checked against the stack when this file was written; MAX_HANDS bounds the search either way.
 */
import { randomUUID } from "node:crypto";

import { rollSelectedAction } from "@g-tee-oh/learning";
import type { ApiPaths } from "@g-tee-oh/contracts";
import { expect, test, type Page, type Response } from "@playwright/test";

import type { DecisionFeedback, TrainerPrompt } from "../../src/contracts.js";
import { indexAtPosition } from "../../src/poker/action-index.js";
import { toGradeActions } from "../../src/poker/grade-actions.js";
import { ownerCredentials } from "../support/owner-credentials.js";
import { mergeShotManifest, shotDirectory, type ShotRecord, type Theme } from "../support/shot-manifest.js";
import { capture, DESKTOP, prepareShotPage, THEMES } from "../support/shots.js";
import { signIn } from "../support/sign-in-flow.js";

type DrillCreateBody = ApiPaths["/api/v1/drills"]["post"]["requestBody"]["content"]["application/json"];

const credentials = ownerCredentials(process.env);
const SKIP_REASON = "Flow 4 needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD; just e2e creates the owner and sets both";
const SHOTS = (process.env["SCREENSHOT_DIR"] ?? "") !== "";
const OUT_DIR = shotDirectory();
const SESSION = "S25";
const SOURCE = "stack";

/** The committed replay seed (O-288): 16 hex digits, the same hands on every run. */
const FLOW_SEED = "5eed00000000f104";
const MAX_HANDS = 30;
/** An action counts toward a mix when the hand plays it more often than this. */
const MIXED_MIN_FREQUENCY = 0.01;
const MIXED_MIN_ACTIONS = 2;
const FLOW_TIMEOUT_MS = 240_000;
const EXPLAINER_NAME = "How RNG mode works";
const HTTP_CREATED = 201;
const HTTP_OK = 200;

const DRILL: DrillCreateBody = {
  name: "flow 4: button opens, online 6-max 100bb",
  tags: ["e2e"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BTN"],
    villain_positions: ["BB"],
    preflop_action: ["rfi"],
    hands: { mode: "all" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "after_action",
    input: "actions",
    grouping: "grouped",
    rng: false,
    pause: "every_action",
    speed: "normal",
    quick_result: false,
    tables: 1,
    timebank_s: null,
    panels: { action_frequency_table: true, threshold_card: true, rng_roller: true },
  },
};

const CRITERIA = {
  start: "R3.13 flow 4 on the stack: start panel with RNG mode switched on (O-283, O-288)",
  explainer: "R3.10 flow 4: the RNG explainer opens on first use (O-283)",
  prompt: "R3.10 flow 4: roll shown before the decision, bands hidden (O-282)",
  tap: "R3.11 flow 4: confidence tap before any reveal (O-284)",
  feedback: "R3.10 R3.13 flow 4: roller after the reveal, roll-selected action Best and in best_action_indexes (O-213, O-282)",
  recap: "R3.13 flow 4: session recap after End session (O-285)",
} as const;

const records: ShotRecord[] = [];
/** The decision route's path, anchored at both ends. */
const DECISION_PATH = /^\/api\/v1\/sessions\/[^/]+\/decisions$/;
const DECISION_TIMEOUT_MS = 15_000;

function isPath(response: Response, method: string, suffix: RegExp): boolean {
  return response.request().method() === method && suffix.test(new URL(response.url()).pathname);
}

async function createDrill(page: Page): Promise<string> {
  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(HTTP_OK);
  const { csrf_token: csrf } = (await me.json()) as { csrf_token: string };
  const created = await page.request.post("/api/v1/drills", {
    headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
    data: DRILL,
  });
  expect(created.status(), "POST /api/v1/drills").toBe(HTTP_CREATED);
  return ((await created.json()) as { id: string }).id;
}

/** Records every prompt GET /next serves, by state version, so a decision can find its buttons. */
function trackPrompts(page: Page): Map<number, TrainerPrompt> {
  const prompts = new Map<number, TrainerPrompt>();
  page.on("response", (response) => {
    if (!isPath(response, "GET", /\/sessions\/[^/]+\/next$/) || response.status() !== HTTP_OK) return;
    void response.json().then(
      (prompt: TrainerPrompt) => prompts.set(prompt.state_version, prompt),
      (error: unknown) => {
        throw new Error(`a GET /next body was not JSON: ${String(error)}`);
      },
    );
  });
  return prompts;
}

function isMixed(feedback: DecisionFeedback): boolean {
  return feedback.freq_by_action.filter((frequency) => frequency > MIXED_MIN_FREQUENCY).length >= MIXED_MIN_ACTIONS;
}

async function expectRollerAgrees(page: Page, feedback: DecisionFeedback, prompt: TrainerPrompt | undefined): Promise<void> {
  expect(prompt, "the prompt of the mixed hand was recorded").toBeDefined();
  expect(feedback.rng_roll, "RNG mode sends the roll with the feedback").not.toBeNull();
  if (prompt === undefined || feedback.rng_roll === null) return;
  const position = rollSelectedAction(feedback.freq_by_action, toGradeActions(prompt.buttons), feedback.rng_roll);
  const selected = indexAtPosition(prompt.buttons, position);
  expect(feedback.best_action_indexes).toContain(selected);
  const panel = page.getByTestId("feedback-panel");
  await expect(panel.getByTestId("feedback-roller")).toBeVisible();
  const best = panel.getByTestId("rng-best");
  await expect(best).toContainText("Best");
  await expect(best).toHaveAttribute("data-action-index", String(selected));
}

interface Shooter {
  (screen: string, criterion: string): Promise<void>;
}

/** Plays hands until the first mixed one and checks it; returns the hands played. */
async function playToMixedHand(page: Page, prompts: Map<number, TrainerPrompt>, shot: Shooter): Promise<number> {
  for (let hand = 1; hand <= MAX_HANDS; hand += 1) {
    await expect(page.getByTestId("roll-badge")).toContainText(/\d+/);
    await expect(page.getByRole("list", { name: "RNG bands" })).toHaveCount(0);
    if (hand === 1) await shot("flow4-prompt-roll", CRITERIA.prompt);
    await page.getByRole("group", { name: "Actions" }).getByRole("button").first().click();
    await expect(page.getByTestId("confidence-tap")).toBeVisible();
    await expect(page.getByTestId("feedback-panel")).toHaveCount(0);
    if (hand === 1) await shot("flow4-confidence", CRITERIA.tap);
    // Exactly POST /api/v1/sessions/{id}/decisions; a missing answer fails with a named reason.
    const answer = page
      .waitForResponse((response) => isPath(response, "POST", DECISION_PATH), { timeout: DECISION_TIMEOUT_MS })
      .catch((error: unknown) => {
        throw new Error(`flow 4 hand ${hand}: no POST decisions response after the tap (${String(error)})`);
      });
    await page.getByRole("button", { name: "Sure", exact: true }).click();
    const response = await answer;
    expect(response.status(), "POST decisions").toBe(HTTP_OK);
    const feedback = (await response.json()) as DecisionFeedback;
    await expect(page.getByTestId("feedback-panel")).toBeVisible();
    if (isMixed(feedback)) {
      // The decided prompt's version: a decision moves the session exactly one version on (S23,
      // O-246), and the browser sends the decision body as a stream Playwright cannot read back.
      await expectRollerAgrees(page, feedback, prompts.get(feedback.state_version - 1));
      await shot("flow4-feedback-roller", CRITERIA.feedback);
      return hand;
    }
    await page.keyboard.press("n");
  }
  throw new Error(`flow 4: no hand mixing ${MIXED_MIN_ACTIONS} or more actions within ${MAX_HANDS} hands of seed ${FLOW_SEED}`);
}

async function openRunWithRng(page: Page, drillId: string, shot: Shooter): Promise<void> {
  await page.goto(`/drills/${drillId}/run?seed=${FLOW_SEED}`);
  await expect(page.getByRole("heading", { name: DRILL.name })).toBeVisible();
  const rngSwitch = page.getByRole("switch", { name: "RNG mode" });
  await rngSwitch.click();
  const explainer = page.getByRole("dialog", { name: EXPLAINER_NAME });
  await expect(explainer, "the explainer opens on first use (O-283)").toBeVisible();
  await shot("flow4-explainer", CRITERIA.explainer);
  await page.keyboard.press("Escape");
  await expect(explainer).toBeHidden();
  await expect(rngSwitch).toHaveAttribute("aria-checked", "true");
  await shot("flow4-start", CRITERIA.start);
  await page.getByRole("button", { name: "Start session" }).click();
  const badge = page.getByTestId("roll-badge");
  await expect(badge).toBeVisible();
  await badge.getByRole("button", { name: EXPLAINER_NAME }).click();
  await expect(explainer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(explainer).toBeHidden();
}

async function flow4(page: Page, theme: Theme): Promise<void> {
  const shot: Shooter = async (screen, criterion) => {
    if (!SHOTS) return;
    records.push(await capture(page, page, OUT_DIR, { screen, theme, viewport: DESKTOP, criterion, source: SOURCE }));
  };
  if (credentials === undefined) return;
  await signIn(page, credentials);
  const drillId = await createDrill(page);
  const prompts = trackPrompts(page);
  await openRunWithRng(page, drillId, shot);
  await playToMixedHand(page, prompts, shot);
  await page.keyboard.press("e");
  await page.getByRole("dialog", { name: "End this session?" }).getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "Session recap" })).toBeVisible();
  await shot("flow4-recap", CRITERIA.recap);
}

test.afterAll(() => {
  if (SHOTS) mergeShotManifest(OUT_DIR, SESSION, records);
});

const RUN_THEMES: readonly Theme[] = SHOTS ? THEMES : ["light"];

for (const theme of RUN_THEMES) {
  test(`R3.10 R3.11 R3.13 flow 4: RNG mode, confidence tap, roller and recap on the stack, ${theme} theme`, async ({ page }) => {
    test.skip(credentials === undefined, SKIP_REASON);
    test.setTimeout(FLOW_TIMEOUT_MS);
    await prepareShotPage(page, theme, DESKTOP);
    await flow4(page, theme);
  });
}
