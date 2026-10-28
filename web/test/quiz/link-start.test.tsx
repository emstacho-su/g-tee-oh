/**
 * A link never starts a practice session on mount (S41, R3.16, R3.17, PR #39 security LOW 2). The
 * four linkable addresses, /quiz?config=..., /quiz?drill=..., /paint?config=... and
 * /paint?drill=..., only prefill what shows: the start screen or spot picker with the link's
 * choices, or a small start card naming the drill-backed quiz or painting session. POST /sessions
 * is sent only once the player presses Start.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FIXTURE_PAINT_DRILL_ID, FIXTURE_PAINT_SESSION_ID, fixturePaintPrompt, fixturePaintSession } from "../../src/fixtures/paint.js";
import { FIXTURE_PREDICTION_DRILL_ID, fixturePredictionPrompt } from "../../src/fixtures/prediction.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { SIGNED_IN, renderApp } from "../app/render-app.js";
import { END_PATH, NEXT_PATH, SESSION_ID, START_PATH, catalogScript, pressStart, renderQuiz } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const QUIZ_CHOICE = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=medium";
const QUIZ_DRILL = `/quiz?drill=${FIXTURE_PREDICTION_DRILL_ID}`;
const PAINT_CHOICE = "/paint?config=cfg_6_online_100&position=BB&spot=vs_open&vs=BTN";
const PAINT_DRILL = `/paint?drill=${FIXTURE_PAINT_DRILL_ID}`;
const PAINT_NEXT = `GET /api/v1/range-paint/${FIXTURE_PAINT_SESSION_ID}/next`;
const START_PAINTING = "Start painting";

function paintScript() {
  return {
    ...SIGNED_IN,
    ...catalogScript(),
    [START_PATH]: [jsonResponse(201, fixturePaintSession)],
    [PAINT_NEXT]: [jsonResponse(200, fixturePaintPrompt)],
  };
}

/** Lets every read the screen started settle, so a POST sent on mount would have been recorded. */
async function settled(isIdle: () => boolean): Promise<void> {
  await waitFor(() => expect(isIdle()).toBe(true));
}

describe("R3.16 a quiz link only prefills (PR #39 security LOW 2)", APP_SUITE, () => {
  it("R3.16 /quiz?config=... fills the start screen and starts nothing until Start quiz", async () => {
    const view = renderQuiz(QUIZ_CHOICE, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("percent"))] });
    const start = await screen.findByRole("button", { name: "Start quiz" });
    await waitFor(() => expect(start).toBeEnabled());
    await settled(() => view.queryClient.isFetching() === 0);
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute("aria-checked", "true");
    expect(view.sentTo(START_PATH)).toHaveLength(0);
    await userEvent.click(start);
    await screen.findByRole("heading", { name: fixturePredictionPrompt("percent").question });
    expect(view.sentTo(START_PATH)).toHaveLength(1);
  });

  it("R3.16 /quiz?drill=... shows a start card naming the drill-backed quiz and starts nothing until Start quiz", async () => {
    const view = renderQuiz(`${QUIZ_DRILL}&seed=00000000deadbeef`, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("yes_no"))] });
    const card = await screen.findByTestId("drill-start-card");
    expect(card).toHaveTextContent(/saved drill/i);
    expect(card).toHaveTextContent(/quiz/i);
    await settled(() => view.queryClient.isFetching() === 0);
    expect(view.sentTo(START_PATH)).toHaveLength(0);
    await userEvent.click(within(card).getByRole("button", { name: "Start quiz" }));
    await screen.findByRole("heading", { name: fixturePredictionPrompt("yes_no").question });
    expect(view.sentTo(START_PATH)).toHaveLength(1);
    expect(view.sentTo(START_PATH)[0]?.body).toEqual({ mode: "prediction", drill_id: FIXTURE_PREDICTION_DRILL_ID, seed: "00000000deadbeef" });
  });

  it("R3.16 pressStart is the helper the other quiz tests start through", async () => {
    const view = renderQuiz(QUIZ_DRILL, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("yes_no"))] });
    await pressStart();
    await screen.findByRole("heading", { name: fixturePredictionPrompt("yes_no").question });
    expect(view.sentTo(START_PATH)).toHaveLength(1);
  });
});

describe("R3.17 a painting link only prefills (PR #39 security LOW 2)", APP_SUITE, () => {
  it("R3.17 /paint?config=... fills the picker and starts nothing until Start painting", async () => {
    const app = renderApp(PAINT_CHOICE, paintScript());
    const opener = await screen.findByRole("radiogroup", { name: "Opener" });
    await waitFor(() => expect(within(opener).getByRole("radio", { name: "BTN" })).toHaveAttribute("aria-checked", "true"));
    expect(within(screen.getByRole("radiogroup", { name: "Position" })).getByRole("radio", { name: "BB" })).toHaveAttribute("aria-checked", "true");
    expect(app.fake.keys()).not.toContain(START_PATH);
    await userEvent.click(screen.getByRole("button", { name: START_PAINTING }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(app.fake.keys().filter((key) => key === START_PATH)).toHaveLength(1);
  });

  it("R3.17 /paint?drill=... shows a start card naming the drill-backed painting and starts nothing until Start painting", async () => {
    const app = renderApp(PAINT_DRILL, paintScript());
    const card = await screen.findByTestId("drill-start-card");
    expect(card).toHaveTextContent(/saved drill/i);
    expect(card).toHaveTextContent(/paint/i);
    expect(app.fake.keys()).not.toContain(START_PATH);
    await userEvent.click(within(card).getByRole("button", { name: START_PAINTING }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    expect(app.fake.keys().filter((key) => key === START_PATH)).toHaveLength(1);
  });
});

const ENDED = {
  ended_at: "2026-10-28T12:00:00Z",
  decisions: 0,
  rated_decisions: 0,
  mean_score: null,
  ev_loss_bb_total: 0,
  rating_changes: [],
  tier: null,
  unlocks: [],
};
const PAINT_END = `POST /api/v1/sessions/${FIXTURE_PAINT_SESSION_ID}/end`;

describe("R3.16 R3.17 leaving a running session by address ends it, and Back never restarts it (PR #39 re-review LOW)", APP_SUITE, () => {
  it("R3.16 a quiz left for /quiz is ended once, and browser Back shows the start screen without a second POST /sessions", async () => {
    const view = renderQuiz(QUIZ_CHOICE, {
      [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("percent"))],
      [END_PATH]: [jsonResponse(200, { ...ENDED, session_id: SESSION_ID })],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Start quiz" }));
    await screen.findByRole("heading", { name: fixturePredictionPrompt("percent").question });
    await act(async () => {
      await view.router.navigate({ to: "/quiz", search: {} });
    });
    await waitFor(() => expect(view.sentTo(END_PATH)).toHaveLength(1));
    act(() => view.history.back());
    expect(await screen.findByRole("button", { name: "Start quiz" })).toBeInTheDocument();
    await settled(() => view.queryClient.isFetching() === 0 && view.queryClient.isMutating() === 0);
    expect(view.sentTo(START_PATH)).toHaveLength(1);
    expect(view.sentTo(END_PATH)).toHaveLength(1);
  });

  it("R3.17 a painting left for /paint is ended once, and browser Back shows the picker without a second POST /sessions", async () => {
    const app = renderApp(PAINT_CHOICE, { ...paintScript(), [PAINT_END]: [jsonResponse(200, { ...ENDED, session_id: FIXTURE_PAINT_SESSION_ID })] });
    await userEvent.click(await screen.findByRole("button", { name: START_PAINTING }));
    expect(await screen.findByTestId("range-painter")).toBeInTheDocument();
    await act(async () => {
      await app.router.navigate({ to: "/paint", search: {} });
    });
    await waitFor(() => expect(app.fake.keys().filter((key) => key === PAINT_END)).toHaveLength(1));
    act(() => app.history.back());
    expect(await screen.findByRole("button", { name: START_PAINTING })).toBeInTheDocument();
    await settled(() => app.queryClient.isFetching() === 0 && app.queryClient.isMutating() === 0);
    expect(app.fake.keys().filter((key) => key === START_PATH)).toHaveLength(1);
    expect(app.fake.keys().filter((key) => key === PAINT_END)).toHaveLength(1);
  });
});
