/**
 * Where the quiz's Enter submits from (R3.16, R3.30, PR #45 review round 4, finding b). PR 45 let
 * the quiz's Enter binding answer from any focused control, so Enter on a focused End quiz button
 * or a link submitted the answer and the control's own action never ran. Enter now submits from
 * the page body or a quiz option only (the yes and no, action and band buttons); every other
 * focused control keeps its own Enter.
 */
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixturePredictionResult, fixturePredictions } from "../../src/fixtures/prediction.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { ANSWER_PATH, END_PATH, NEXT_PATH, renderStartedQuiz, typeReason, type QuizView } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const RUN_PATH = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=easy";

function yesNoEntry(): (typeof fixturePredictions)[number] {
  const entry = fixturePredictions.find((item) => item.prompt.answer_kind === "yes_no");
  if (entry === undefined) throw new Error("no yes_no fixture prediction");
  return entry;
}

const YES_NO = yesNoEntry();

const RECAP = {
  session_id: YES_NO.prompt.session_id,
  ended_at: "2026-10-28T12:00:00Z",
  decisions: 0,
  rated_decisions: 0,
  mean_score: null,
  ev_loss_bb_total: 0,
  rating_changes: [],
  tier: null,
  unlocks: [],
};

/** A started quiz on the yes or no question, with a complete answer: a reason and No chosen. */
async function readyToSubmit(): Promise<QuizView> {
  const view = await renderStartedQuiz(RUN_PATH, {
    [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)],
    [ANSWER_PATH]: [jsonResponse(200, fixturePredictionResult(YES_NO, { kind: "yes_no", value: false }, 0))],
    [END_PATH]: [jsonResponse(200, RECAP)],
  });
  await screen.findByRole("heading", { name: YES_NO.prompt.question });
  await typeReason();
  await userEvent.click(screen.getByRole("button", { name: "No" }));
  return view;
}

describe("R3.16 the quiz's Enter submits from an option or the page only (PR #45 review round 4, finding b)", APP_SUITE, () => {
  it("R3.16 Enter right after choosing an option, with the focus on that option, still submits", async () => {
    const view = await readyToSubmit();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "No" }));
    await userEvent.keyboard("{Enter}");
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
  });

  it("R3.16 Enter with the focus on the page body submits", async () => {
    const view = await readyToSubmit();
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("{Enter}");
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
  });

  it("R3.16 R3.30 Enter on the focused End quiz button ends the quiz and submits nothing", async () => {
    const view = await readyToSubmit();
    screen.getByRole("button", { name: "End quiz" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(view.sentTo(END_PATH)).toHaveLength(1));
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
  });

  it("R3.16 R3.30 Enter on a focused link follows it and submits nothing", async () => {
    const view = await readyToSubmit();
    const [link] = screen.getAllByRole("link");
    if (link === undefined) throw new Error("the quiz page has no link");
    link.focus();
    await userEvent.keyboard("{Enter}");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
  });
});
