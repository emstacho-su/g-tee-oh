/**
 * A quiz whose spots cannot ask its difficulty on its chosen kinds (S41, R3.16, O-411 amended): the
 * api answers 422 no-quiz-questions at the start (POST /sessions) or mid-quiz (GET next). The web
 * builds its own sentence from the quiz's choices (the difficulty's name, and the kind word only
 * when exactly one kind was chosen), never the server's detail, and offers End quiz and a way back
 * to the start screen. Also the quiz header: the difficulty's name next to the level badge for a
 * quiz session, and not for a drill-backed one.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_PREDICTION_DRILL_ID, fixturePredictionPrompt, fixturePredictionResult, fixturePredictions } from "../../src/fixtures/prediction.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { ANSWER_PATH, END_PATH, NEXT_PATH, START_PATH, pressStart, renderQuiz, typeReason } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const ADDRESS = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open";
const HARD_HAND = `${ADDRESS}&kinds=hand&difficulty=hard`;
const EASY_BOTH = `${ADDRESS}&kinds=range,hand&difficulty=easy`;
const HARD_HAND_TEXT = "No more Hard hand questions in these spots; try more spot types or another difficulty.";
const EASY_BOTH_TEXT = "No more Easy questions in these spots; try more spot types or another difficulty.";
const BACK = "Back to the start screen";
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

function noQuestions() {
  return jsonResponse(422, {
    type: "urn:g-tee-oh:problem:no-quiz-questions",
    title: "No questions at this difficulty in these spots",
    status: 422,
    detail: "server detail text",
  });
}

function firstPrediction(): (typeof fixturePredictions)[number] {
  const entry = fixturePredictions[0];
  if (entry === undefined) throw new Error("fixture prediction missing");
  return entry;
}

describe("R3.16 no-quiz-questions (O-411 amended)", APP_SUITE, () => {
  it("R3.16 at the start: the quiz's own sentence with the kind when one kind was chosen, End quiz and a way back", async () => {
    const view = renderQuiz(HARD_HAND, { [START_PATH]: [noQuestions()] });
    await pressStart();
    const notice = await screen.findByTestId("no-quiz-questions");
    expect(notice).toHaveTextContent(HARD_HAND_TEXT);
    expect(document.body).not.toHaveTextContent("server detail text");
    expect(screen.getByRole("button", { name: "End quiz" })).toBeInTheDocument();
    await userEvent.click(within(notice).getByRole("button", { name: BACK }));
    expect(await screen.findByRole("combobox", { name: "Table" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Hard" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Hand questions" })).toHaveAttribute("aria-pressed", "true");
    expect(view.sentTo(END_PATH)).toHaveLength(0);
  });

  it("R3.16 mid-quiz: GET next answering no-quiz-questions shows the sentence without the kind when both were chosen; Back ends the session", async () => {
    const entry = firstPrediction();
    const view = renderQuiz(EASY_BOTH, {
      [NEXT_PATH]: [jsonResponse(200, entry.prompt), noQuestions()],
      [ANSWER_PATH]: [jsonResponse(200, fixturePredictionResult(entry, { kind: "yes_no", value: true }, 0))],
      [END_PATH]: [jsonResponse(200, RECAP)],
    });
    await pressStart();
    await screen.findByRole("heading", { name: entry.prompt.question });
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await typeReason();
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next question" }));
    const notice = await screen.findByTestId("no-quiz-questions");
    expect(notice).toHaveTextContent(EASY_BOTH_TEXT);
    expect(document.body).not.toHaveTextContent("server detail text");
    expect(screen.getByRole("button", { name: "End quiz" })).toBeInTheDocument();
    await userEvent.click(within(notice).getByRole("button", { name: BACK }));
    expect(await screen.findByRole("combobox", { name: "Table" })).toBeInTheDocument();
    await waitFor(() => expect(view.sentTo(END_PATH)).toHaveLength(1));
  });
});

describe("R3.16 the quiz header names the difficulty", APP_SUITE, () => {
  it("R3.16 a quiz session shows Hard next to Range level 3 of 3", async () => {
    const prompt = fixturePredictionPrompt("regions");
    renderQuiz(`${ADDRESS}&kinds=range&difficulty=hard`, { [NEXT_PATH]: [jsonResponse(200, prompt)] });
    await pressStart();
    await screen.findByRole("heading", { name: prompt.question });
    expect(screen.getByTestId("level-badge")).toHaveTextContent("Range level 3 of 3");
    expect(screen.getByTestId("difficulty-badge")).toHaveTextContent("Hard");
  });

  it("R3.16 a drill-backed session keeps its header without a difficulty", async () => {
    renderQuiz(`/quiz?drill=${FIXTURE_PREDICTION_DRILL_ID}`, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("yes_no"))] });
    await pressStart();
    await screen.findByRole("heading", { name: fixturePredictionPrompt("yes_no").question });
    expect(screen.getByTestId("level-badge")).toHaveTextContent("Range level 1 of 3");
    expect(screen.queryByTestId("difficulty-badge")).not.toBeInTheDocument();
  });
});
