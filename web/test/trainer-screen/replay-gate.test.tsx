/**
 * The opponent-action replay on the trainer screens (S38, R3.13, O-381, O-382, O-284, PM note b):
 * while the line before the hero's decision plays on the table, the action bar waits and the
 * response timer is paused; a click on the table or an action key finishes the replay at once,
 * never submits, and the replay's time is never counted in response_ms. The screens render with
 * motion here (renderRun and renderTrain default to reduced motion for every other test).
 */
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_AUTOMATED_SESSION_ID, fixtureAutomatedSession, fixtureBlockPrompt, fixtureRatedBlock } from "../../src/fixtures/automated.js";
import { fixtureDrill, fixturePlainFeedback, fixturePlainPrompt, fixtureRecap } from "../../src/fixtures/trainer.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { AUTOMATED_PATHS, START_PATH as TRAIN_START_PATH, renderTrain, resetDefaults } from "../train/render-train.js";
import { DECIDE_PATH, END_PATH, NEXT_PATH, renderRun, type RunView } from "./render-run.js";

const SHOWN_AT = 1_000;
const REPLAY_ENDED_AT = 4_000;
const CHOSEN_AT = 5_000;
const RAISE_NAME = "Raise to 2.5bb";

const PLAY_SCRIPT = {
  [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)],
  [DECIDE_PATH]: [jsonResponse(200, fixturePlainFeedback)],
  [END_PATH]: [jsonResponse(200, fixtureRecap)],
};

function actionButtons(): HTMLElement[] {
  return within(screen.getByRole("group", { name: "Actions" })).getAllByRole("button");
}

async function startWithMotion(): Promise<RunView> {
  const view = renderRun({ script: PLAY_SCRIPT, motion: true });
  await screen.findByRole("heading", { name: fixtureDrill.name });
  view.clock.now = SHOWN_AT;
  await userEvent.click(screen.getByRole("button", { name: "Start session" }));
  await screen.findByRole("group", { name: "Actions" });
  return view;
}

afterEach(() => {
  resetDefaults();
});

describe("R3.13 the replay gates the drill run's action bar", () => {
  it("R3.13 the fixture hand has a line to replay", () => {
    // Without history the replay would be empty and these tests would prove nothing.
    expect(fixturePlainPrompt.history.length).toBeGreaterThan(0);
  });

  it("R3.13 the action bar waits while the line replays, and a click on the table finishes it at once", async () => {
    await startWithMotion();
    for (const button of actionButtons()) expect(button).toBeDisabled();
    await userEvent.click(screen.getByTestId("poker-table"));
    // No waiting: the very next check after the click finds the bar live.
    for (const button of actionButtons()) expect(button).toBeEnabled();
    expect(screen.getByRole("log", { name: "Action this hand" })).toHaveTextContent("Your turn");
  });

  it("R3.13 an action key during the replay finishes it without submitting a decision", async () => {
    const view = await startWithMotion();
    expect(actionButtons()[0]).toBeDisabled();
    await userEvent.keyboard("1");
    for (const button of actionButtons()) expect(button).toBeEnabled();
    expect(view.sentTo(DECIDE_PATH)).toHaveLength(0);
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
  });

  it("R3.13 the replay's time is not counted in response_ms (O-284, PM note b)", async () => {
    const view = await startWithMotion();
    // The replay runs from SHOWN_AT until the table click at REPLAY_ENDED_AT; only the time after counts.
    view.clock.now = REPLAY_ENDED_AT;
    await userEvent.click(screen.getByTestId("poker-table"));
    view.clock.now = CHOSEN_AT;
    await userEvent.click(screen.getByRole("button", { name: RAISE_NAME }));
    await screen.findByTestId("feedback-panel");
    expect(view.sentTo(DECIDE_PATH)[0]?.body).toMatchObject({ response_ms: CHOSEN_AT - REPLAY_ENDED_AT });
  });
});

describe("R3.13 the replay gates /train's action bar", () => {
  it("R3.13 the automated session's action bar waits for the replay and a table click releases it", async () => {
    const prompt = fixtureBlockPrompt(fixtureRatedBlock, 0, FIXTURE_AUTOMATED_SESSION_ID, 1);
    await renderTrain(
      "automated",
      {
        [TRAIN_START_PATH]: [jsonResponse(201, fixtureAutomatedSession(fixtureRatedBlock))],
        [AUTOMATED_PATHS.next]: [jsonResponse(200, prompt)],
      },
      { motion: true },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Start training" }));
    await screen.findByRole("group", { name: "Actions" });
    if (prompt.history.length > 0) for (const button of actionButtons()) expect(button).toBeDisabled();
    await userEvent.click(screen.getByTestId("poker-table"));
    for (const button of actionButtons()) expect(button).toBeEnabled();
  });
});
