/**
 * /train's start panels and running session (S32, R4.10, R3.11, O-272, O-284, O-323, O-325,
 * O-328): the start body per mode (never a seed for automated), the scope named from /configs,
 * the block banner for a rated block and a worked example, the holdout banner, the confidence tap
 * before any decision, and the problems a start or a session can meet.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ME_QUERY_KEY } from "../../src/auth/index.js";
import {
  FIXTURE_AUTOMATED_SESSION_ID,
  fixtureAutomatedSession,
  fixtureBlockPrompt,
  fixtureHoldoutPrompt,
  fixtureHoldoutSession,
  fixtureRatedBlock,
  fixtureWorkedBlock,
} from "../../src/fixtures/automated.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { fixturePlainFeedback } from "../../src/fixtures/trainer.js";
import type { GameConfig } from "../../src/progress/types.js";
import { jsonResponse, networkFailure, problemResponse } from "../api/fake-fetch.js";
import { AUTOMATED_PATHS, CONFIGS_PATH, HOLDOUT_PATHS, START_PATH, renderTrain, resetDefaults, setDefaults } from "./render-train.js";

/** The study fixture's online 6-max 100 bb configuration. */
const CONFIG: GameConfig = fixtureConfigs[0] as GameConfig;
const UNLISTED_ID = "cfg_6_online_999";

const ratedFeedback = { ...fixturePlainFeedback, rated: true, state_version: 2 };

function automatedScript(block = fixtureRatedBlock) {
  return {
    [START_PATH]: [jsonResponse(201, fixtureAutomatedSession(block))],
    [AUTOMATED_PATHS.next]: [
      jsonResponse(200, fixtureBlockPrompt(block, 0, FIXTURE_AUTOMATED_SESSION_ID, 1)),
      jsonResponse(200, fixtureBlockPrompt(block, 1, FIXTURE_AUTOMATED_SESSION_ID, 2)),
    ],
    [AUTOMATED_PATHS.decide]: [jsonResponse(200, ratedFeedback)],
  };
}

async function chooseFirstAction(): Promise<void> {
  const actions = await screen.findByRole("group", { name: "Actions" });
  const [first] = within(actions).getAllByRole("button");
  if (first === undefined) throw new Error("the prompt has no action buttons");
  await userEvent.click(first);
}

async function decide(): Promise<void> {
  await chooseFirstAction();
  await userEvent.click(screen.getByRole("button", { name: "Sure" }));
  await screen.findByTestId("feedback-panel");
}

afterEach(() => {
  resetDefaults();
});

describe("R4.10 automated start", () => {
  it("R4.10 the start panel names every covered configuration, the grouping and RNG from the defaults, with a Settings link", async () => {
    setDefaults({ grouping: "grouped", rng: true });
    await renderTrain("automated", {});
    expect(screen.getByRole("heading", { level: 1, name: "Automated training" })).toBeInTheDocument();
    expect(await screen.findByTestId("scope-all")).toHaveTextContent("All covered configurations");
    expect(screen.getByTestId("start-grouping")).toHaveTextContent("Grouped");
    expect(screen.getByTestId("start-rng")).toHaveTextContent("On");
    expect(screen.getByRole("link", { name: "Change these in Settings" })).toHaveAttribute("href", "/settings");
  });

  it("R4.10 Start sends mode automated with grouping and rng, no config_ids and never a seed (O-325)", async () => {
    setDefaults({ grouping: "simple", rng: false });
    const view = await renderTrain("automated", automatedScript());
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await screen.findByRole("group", { name: "Actions" });
    const [start] = view.sentTo(START_PATH);
    expect(start?.body).toEqual({ mode: "automated", settings: { grouping: "simple", rng: false } });
    expect(start?.idempotencyKey).toMatch(/^key-\d+$/);
  });

  it("R4.10 a chosen scope is named from /configs (an unlisted id shown as is) and sent as config_ids", async () => {
    setDefaults({ configScope: [CONFIG.config_id, UNLISTED_ID] });
    const view = await renderTrain("automated", { ...automatedScript(), [CONFIGS_PATH]: [jsonResponse(200, { items: [CONFIG], next_cursor: null })] });
    const list = await screen.findByTestId("scope-list");
    expect(list).toHaveTextContent("Online, 6 players, 100 bb deep, stakes online");
    expect(list).toHaveTextContent(UNLISTED_ID);
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await screen.findByRole("group", { name: "Actions" });
    expect(view.sentTo(START_PATH)[0]?.body).toEqual({
      mode: "automated",
      settings: { grouping: "standard", rng: false },
      config_ids: [CONFIG.config_id, UNLISTED_ID],
    });
  });

  it("R4.10 a failed /configs read says so with Try again, which reads the names again", async () => {
    setDefaults({ configScope: [CONFIG.config_id] });
    await renderTrain("automated", { [CONFIGS_PATH]: [problemResponse(503, "unavailable"), jsonResponse(200, { items: [CONFIG], next_cursor: null })] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The configuration names could not be loaded. 1 chosen.");
    expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("scope-list")).toHaveTextContent("Online, 6 players");
  });

  it("R4.10 a 422 no-coverage names the scope, not a drill, links the library and leaves Start to retry", async () => {
    await renderTrain("automated", { [START_PATH]: [problemResponse(422, "no-coverage", "server detail never shown")] });
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The library covers no spot class in this scope yet.");
    expect(alert).not.toHaveTextContent("server detail never shown");
    expect(screen.getByRole("link", { name: "Open the library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
  });

  it("R4.10 a 401 on start signs out: the me query becomes null", async () => {
    const view = await renderTrain("automated", { [START_PATH]: [problemResponse(401, "unauthenticated")] });
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await screen.findByRole("alert");
    expect(view.queryClient.getQueryData(ME_QUERY_KEY)).toBeNull();
  });
});

describe("R4.10 automated session", () => {
  it("R4.10 a rated block's banner names family and track, hand 1 of 3, and that it counts; Next moves to hand 2", async () => {
    await renderTrain("automated", automatedScript());
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    const banner = await screen.findByTestId("block-banner");
    await waitFor(() => expect(within(banner).getByTestId("block-class")).toHaveTextContent("rfi, Opens"));
    expect(within(banner).getByTestId("block-hand")).toHaveTextContent("Hand 1 of 3 in this block");
    expect(within(banner).getByTestId("block-rating")).toHaveTextContent("Rated block: first attempts count toward your rating");
    await decide();
    await userEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await waitFor(() => expect(screen.getByTestId("block-hand")).toHaveTextContent("Hand 2 of 3 in this block"));
  });

  it("R4.10 a worked example's banner says panels visible, not rated (O-272)", async () => {
    await renderTrain("automated", automatedScript(fixtureWorkedBlock));
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(await screen.findByTestId("block-rating")).toHaveTextContent("Worked example: panels visible, not rated");
    await waitFor(() => expect(screen.getByTestId("block-class")).toHaveTextContent("facing-open, Facing an open in position"));
  });

  it("R3.11 R4.10 nothing is sent and nothing revealed before the confidence tap (O-284)", async () => {
    const view = await renderTrain("automated", automatedScript());
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await chooseFirstAction();
    expect(screen.getByTestId("confidence-tap")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    expect(view.sentTo(AUTOMATED_PATHS.decide)).toHaveLength(0);
    await userEvent.keyboard("u");
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(AUTOMATED_PATHS.decide)[0]?.body).toMatchObject({ confidence: "unsure", state_version: 1 });
  });

  it("R4.10 a network failure on a decision offers Try again, which resends the same key", async () => {
    const view = await renderTrain("automated", { ...automatedScript(), [AUTOMATED_PATHS.decide]: [networkFailure(), jsonResponse(200, ratedFeedback)] });
    await userEvent.click(screen.getByRole("button", { name: "Start training" }));
    await chooseFirstAction();
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The request did not reach the server.");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByTestId("feedback-panel");
    const [first, second] = view.sentTo(AUTOMATED_PATHS.decide);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });
});

describe("R4.10 holdout retest (O-328)", () => {
  const holdoutScript = {
    [START_PATH]: [jsonResponse(201, fixtureHoldoutSession)],
    [HOLDOUT_PATHS.next]: [jsonResponse(200, fixtureHoldoutPrompt(0, 1)), jsonResponse(200, fixtureHoldoutPrompt(1, 2))],
    [HOLDOUT_PATHS.decide]: [jsonResponse(200, { ...fixturePlainFeedback, state_version: 2 })],
  };

  it("R4.10 the holdout start sends its mode alone; the banner says not rated with answered of total", async () => {
    setDefaults({ grouping: "grouped", rng: true });
    const view = await renderTrain("holdout", holdoutScript);
    expect(screen.getByRole("heading", { level: 1, name: "Holdout retest" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start the retest" }));
    const banner = await screen.findByTestId("block-banner");
    expect(banner).toHaveTextContent("Holdout retest: not rated");
    expect(within(banner).getByTestId("holdout-answered")).toHaveTextContent("12 of 30 answered");
    expect(view.sentTo(START_PATH)[0]?.body).toEqual({ mode: "holdout" });
    await decide();
    expect(screen.getByTestId("holdout-answered")).toHaveTextContent("13 of 30 answered");
  });

  it("R4.10 the answered count keeps the decided item while the next prompt loads (O-328)", async () => {
    await renderTrain("holdout", {
      ...holdoutScript,
      [HOLDOUT_PATHS.next]: [jsonResponse(200, fixtureHoldoutPrompt(0, 1)), () => new Promise<Response>(() => undefined)],
    });
    await userEvent.click(screen.getByRole("button", { name: "Start the retest" }));
    await decide();
    expect(screen.getByTestId("holdout-answered")).toHaveTextContent("13 of 30 answered");
    await userEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await waitFor(() => expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument());
    expect(screen.getByTestId("holdout-answered")).toHaveTextContent("13 of 30 answered");
  });

  it("R4.10 a finished round (409) and a round with no items (422) each get their own sentence", async () => {
    await renderTrain("holdout", { [START_PATH]: [problemResponse(409, "holdout-complete"), problemResponse(422, "no-holdout-items")] });
    await userEvent.click(screen.getByRole("button", { name: "Start the retest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This month's retest is complete.");
    await userEvent.click(screen.getByRole("button", { name: "Start the retest" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No retest spots are drawn for this round yet."));
    expect(screen.queryByRole("link", { name: "Open the library" })).not.toBeInTheDocument();
  });

  it("R4.10 a 409 or 422 that is not a holdout problem gets the generic sentence, on start and in a running retest", async () => {
    await renderTrain("holdout", {
      [START_PATH]: [problemResponse(409, "idempotency-in-flight"), jsonResponse(201, fixtureHoldoutSession)],
      [HOLDOUT_PATHS.next]: [jsonResponse(200, fixtureHoldoutPrompt(0, 1))],
      [HOLDOUT_PATHS.decide]: [problemResponse(422, "validation")],
    });
    await userEvent.click(screen.getByRole("button", { name: "Start the retest" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("retest is complete");
    await userEvent.click(screen.getByRole("button", { name: "Start the retest" }));
    await chooseFirstAction();
    await userEvent.click(screen.getByRole("button", { name: "Sure" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The request failed (status 422).");
    expect(alert).not.toHaveTextContent("No retest spots");
  });
});
