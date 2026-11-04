/**
 * Where the quiz's Enter submits from (R3.16, R3.30, PR #45 review round 4 finding b, PR #49
 * review round 1). PR 45 let the quiz's Enter binding answer from any focused control, so Enter on
 * a focused End quiz button or a link submitted the answer and the control's own action never ran.
 * Enter now submits from the page body, the chosen option, or a region checkbox; Enter on an
 * unchosen option picks it (its own click), and every other focused control keeps its own Enter.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fixturePredictionResult, fixturePredictions } from "../../src/fixtures/prediction.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { ANSWER_PATH, END_PATH, NEXT_PATH, renderStartedQuiz, typeReason, type QuizView } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const RUN_PATH = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=easy";

type Entry = (typeof fixturePredictions)[number];
type PredictionAnswer = Parameters<typeof fixturePredictionResult>[1];

function entryOf(kind: Entry["prompt"]["answer_kind"]): Entry {
  const entry = fixturePredictions.find((item) => item.prompt.answer_kind === kind);
  if (entry === undefined) throw new Error(`no ${kind} fixture prediction`);
  return entry;
}

const YES_NO = entryOf("yes_no");
const ACTION = entryOf("action");
const REGIONS = entryOf("regions");

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

async function startOn(entry: Entry, answer: PredictionAnswer): Promise<QuizView> {
  const view = await renderStartedQuiz(RUN_PATH, {
    [NEXT_PATH]: [jsonResponse(200, entry.prompt)],
    [ANSWER_PATH]: [jsonResponse(200, fixturePredictionResult(entry, answer, 0))],
    [END_PATH]: [jsonResponse(200, RECAP)],
  });
  await screen.findByRole("heading", { name: entry.prompt.question });
  await typeReason();
  return view;
}

/** A started quiz on the yes or no question, with a complete answer: a reason and No chosen. */
async function readyToSubmit(): Promise<QuizView> {
  const view = await startOn(YES_NO, { kind: "yes_no", value: false });
  await userEvent.click(screen.getByRole("button", { name: "No" }));
  return view;
}

describe("R3.16 the quiz's Enter submits from the chosen option or the page only (PR #45 round 4 b, PR #49 round 1)", APP_SUITE, () => {
  it("R3.16 Enter right after choosing an option, with the focus on that option, still submits", async () => {
    const view = await readyToSubmit();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "No" }));
    expect(document.activeElement).toHaveAttribute("aria-pressed", "true");
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

  it("R3.16 Enter on an unchosen option picks it and sends nothing; a second Enter on it sends the new choice (PR #49 round 1, finding 1)", async () => {
    const view = await startOn(ACTION, { kind: "action", action_index: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    const raise = screen.getByRole("button", { name: "Raise to 10bb" });
    expect(raise).toHaveAttribute("aria-pressed", "false");
    raise.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Raise to 10bb" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Call" })).toHaveAttribute("aria-pressed", "false");
    expect(view.sentTo(ANSWER_PATH), "the first Enter only picks the focused option").toHaveLength(0);
    await userEvent.keyboard("{Enter}");
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
    expect(view.sentTo(ANSWER_PATH)[0]?.body).toMatchObject({ answer: { kind: "action", action_index: 2 } });
  });

  it("R3.16 Enter on an unticked region ticks it and sends nothing (PR #49 round 2, the HIGH)", async () => {
    const view = await startOn(REGIONS, { kind: "regions", value: ["pairs", "suited_aces"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Pairs" }));
    const suited = screen.getByRole("checkbox", { name: "Suited aces" });
    expect(suited).not.toBeChecked();
    suited.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("checkbox", { name: "Suited aces" })).toBeChecked();
    expect(view.sentTo(ANSWER_PATH), "Enter on an unticked region only ticks it").toHaveLength(0);
    expect(screen.queryByTestId("prediction-result")).not.toBeInTheDocument();
  });

  it("R3.16 Enter on a ticked region with a complete answer sends it with every ticked region (PR #49 round 2)", async () => {
    const view = await startOn(REGIONS, { kind: "regions", value: ["pairs", "suited_aces"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Pairs" }));
    const suited = screen.getByRole("checkbox", { name: "Suited aces" });
    await userEvent.click(suited);
    expect(document.activeElement).toBe(suited);
    await userEvent.keyboard("{Enter}");
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
    expect(view.sentTo(ANSWER_PATH)[0]?.body).toMatchObject({ answer: { kind: "regions", value: ["pairs", "suited_aces"] } });
  });

  it("R3.16 R3.30 Enter on the focused End quiz button ends the quiz and submits nothing", async () => {
    const view = await readyToSubmit();
    screen.getByRole("button", { name: "End quiz" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(view.sentTo(END_PATH)).toHaveLength(1));
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
  });

  it("R3.16 R3.30 Enter on the focused Home link follows it and submits nothing (PR #49 round 1, finding 5)", async () => {
    const view = await readyToSubmit();
    const home = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Home" });
    home.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
  });
});
