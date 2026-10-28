/**
 * The quiz's reason, result, Previous and End (S41, R3.16, O-410, O-412, O-414): the reason field
 * (label, field class, limit, live count, the 3-character rule, Enter types a newline), the passed
 * mark of a quiz result without unlock wording, the read-only review of earlier answers held in
 * client state only, End quiz back to the start screen, and the answered list never surviving a
 * sign-out into another session.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ME_QUERY_KEY } from "../../src/auth/session.js";
import { FIELD_CLASS } from "../../src/components/ui/index.js";
import type { PredictionResult } from "../../src/contracts.js";
import { fixtureSession } from "../../src/fixtures/index.js";
import { fixturePredictionPrompt, fixturePredictionResult, fixturePredictions } from "../../src/fixtures/prediction.js";
import { jsonResponse, noContent } from "../api/fake-fetch.js";
import { ANSWER_PATH, END_PATH, NEXT_PATH, START_PATH, renderQuiz, typeReason } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const QUIZ = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=easy";
const REASON_LABEL = "Your reason (required)";
const RECAP = {
  session_id: fixturePredictions[0]?.prompt.session_id,
  ended_at: "2026-10-28T12:00:00Z",
  decisions: 0,
  rated_decisions: 0,
  mean_score: null,
  ev_loss_bb_total: 0,
  rating_changes: [],
  tier: null,
  unlocks: [],
};

function fixtureAt(index: number): (typeof fixturePredictions)[number] {
  const entry = fixturePredictions[index];
  if (entry === undefined) throw new Error(`no fixture prediction at ${index}`);
  return entry;
}

const YES_NO = fixtureAt(0);
const ACTION = fixtureAt(1);
const SECOND = { ...ACTION.prompt, state_version: 1 };
const THIRD = { ...fixturePredictionPrompt("percent"), state_version: 2 };

function passedResult(): PredictionResult {
  return { ...fixturePredictionResult(YES_NO, { kind: "yes_no", value: true }, 0), level_passed: true, next_level_unlocked: true, new_level: 2 };
}

function twoAnswers() {
  return {
    [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt), jsonResponse(200, SECOND), jsonResponse(200, THIRD)],
    [ANSWER_PATH]: [jsonResponse(200, passedResult()), jsonResponse(200, { ...fixturePredictionResult(ACTION, { kind: "action", action_index: 2 }, 1), prompt_id: SECOND.prompt_id })],
    [END_PATH]: [jsonResponse(200, RECAP)],
  };
}

async function answerYesNo(reason: string): Promise<void> {
  await screen.findByRole("heading", { name: YES_NO.prompt.question });
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  await typeReason(reason);
  await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
  await screen.findByTestId("prediction-result");
}

async function answerAction(reason: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next question" }));
  await screen.findByRole("heading", { name: SECOND.question });
  await userEvent.click(screen.getByRole("button", { name: /Raise to 10bb/ }));
  await typeReason(reason);
  await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
  await screen.findByTestId("prediction-result");
}

describe("R3.16 the required reason (O-412)", APP_SUITE, () => {
  it("R3.16 a labelled textarea with the field class, a 1,000 limit and a live count", async () => {
    renderQuiz(QUIZ, { [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)] });
    await screen.findByRole("heading", { name: YES_NO.prompt.question });
    const field = screen.getByRole("textbox", { name: REASON_LABEL });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("maxlength", "1000");
    for (const name of FIELD_CLASS.split(" ")) expect(field).toHaveClass(name);
    expect(screen.getByText("0 / 1000")).toBeInTheDocument();
    await userEvent.type(field, "abcd");
    expect(screen.getByText("4 / 1000")).toBeInTheDocument();
  });

  it("R3.16 Submit and the Enter hotkey wait for 3 characters after trimming", async () => {
    const view = renderQuiz(QUIZ, { [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)], [ANSWER_PATH]: [jsonResponse(200, passedResult())] });
    await screen.findByRole("heading", { name: YES_NO.prompt.question });
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await typeReason("  ab   ");
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Yes/ }));
    await userEvent.keyboard("{Enter}");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
    await typeReason("c");
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeEnabled();
  });

  it("R3.16 Enter inside the reason types a newline and never submits", async () => {
    const view = renderQuiz(QUIZ, { [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)], [ANSWER_PATH]: [jsonResponse(200, passedResult())] });
    await screen.findByRole("heading", { name: YES_NO.prompt.question });
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await typeReason("first line{Enter}second line");
    expect(screen.getByRole("textbox", { name: REASON_LABEL })).toHaveValue("first line\nsecond line");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
    expect(screen.queryByTestId("prediction-result")).not.toBeInTheDocument();
  });
});

describe("R3.16 a quiz result (O-410)", APP_SUITE, () => {
  it("R3.16 shows the passed mark and the window counts, and no unlock wording", async () => {
    renderQuiz(QUIZ, twoAnswers());
    await answerYesNo("Calls are cheap here.");
    const panel = screen.getByTestId("prediction-result");
    expect(within(panel).getByText("Passed Easy at this spot")).toBeInTheDocument();
    expect(within(panel).getByText(/18 correct of 20/)).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/unlock/i);
    expect(panel.textContent).not.toMatch(/rating|score|grade/i);
  });
});

describe("R3.16 Previous (O-414)", APP_SUITE, () => {
  it("R3.16 shows no Previous before the first answer", async () => {
    renderQuiz(QUIZ, twoAnswers());
    await screen.findByRole("heading", { name: YES_NO.prompt.question });
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  });

  it("R3.16 reviews earlier answers read-only, steps back and forward, and returns to the draft intact", async () => {
    const view = renderQuiz(QUIZ, twoAnswers());
    await answerYesNo("Calls are cheap here.");
    await answerAction("Suited wheel ace raises.");
    await userEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: THIRD.question });
    await userEvent.type(screen.getByRole("spinbutton"), "35");
    await typeReason("draft in progress");
    const reads = view.sentTo(NEXT_PATH).length;

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    const review = await screen.findByTestId("answer-review");
    expect(within(review).getByRole("heading", { name: SECOND.question })).toBeInTheDocument();
    expect(within(review).getByText("Suited wheel ace raises.")).toBeInTheDocument();
    expect(within(review).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(review).getByRole("button", { name: /Raise to 10bb/ })).toHaveAttribute("aria-pressed", "true");
    for (const button of within(within(review).getByRole("group", { name: "Most frequent action" })).getAllByRole("button")) expect(button).toBeDisabled();
    expect(within(review).getByTestId("prediction-result")).toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "Next question" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newer" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(within(screen.getByTestId("answer-review")).getByRole("heading", { name: YES_NO.prompt.question })).toBeInTheDocument();
    expect(within(screen.getByTestId("answer-review")).getByText("Calls are cheap here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Newer" }));
    expect(within(screen.getByTestId("answer-review")).getByRole("heading", { name: SECOND.question })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to current question" }));
    expect(screen.queryByTestId("answer-review")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(35);
    expect(screen.getByRole("textbox", { name: REASON_LABEL })).toHaveValue("draft in progress");
    expect(view.sentTo(NEXT_PATH)).toHaveLength(reads);
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(2);
  });

  it("R3.16 Previous also shows on a result once an answer exists, and the hotkeys stay off in review", async () => {
    const view = renderQuiz(QUIZ, twoAnswers());
    await answerYesNo("Calls are cheap here.");
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByTestId("answer-review");
    await userEvent.keyboard("n");
    expect(screen.getByTestId("answer-review")).toBeInTheDocument();
    expect(view.sentTo(NEXT_PATH)).toHaveLength(1);
  });
});

describe("R3.16 End quiz and sign-out clear the run (O-414)", APP_SUITE, () => {
  it("R3.16 End quiz posts the end with the csrf token and returns to the start screen without the answered list", async () => {
    const view = renderQuiz(QUIZ, twoAnswers());
    await answerYesNo("Calls are cheap here.");
    await userEvent.click(screen.getByRole("button", { name: "End quiz" }));
    expect(await screen.findByRole("combobox", { name: "Table" })).toBeInTheDocument();
    const [end] = view.sentTo(END_PATH);
    expect(end?.csrf).not.toBeNull();
    expect(view.router.state.location.search).toEqual({});
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Easy" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Facing an open" })).toHaveAttribute("aria-pressed", "true");
  });

  it("R3.16 after a sign-out the answered list is gone: the next session starts fresh with no Previous", async () => {
    const view = renderQuiz(QUIZ, { ...twoAnswers(), "POST /api/v1/auth/logout": [noContent()] });
    await answerYesNo("Calls are cheap here.");
    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(screen.queryByText("Calls are cheap here.")).not.toBeInTheDocument();
    await act(async () => {
      view.queryClient.setQueryData(ME_QUERY_KEY, fixtureSession);
      await Promise.resolve();
    });
    await act(() => view.router.navigate({ href: QUIZ }));
    await waitFor(() => expect(view.sentTo(START_PATH)).toHaveLength(2));
    await screen.findByRole("heading", { level: 1, name: "Quizzes" });
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  });
});
