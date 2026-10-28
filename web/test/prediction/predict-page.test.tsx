/**
 * The /predict screen (S27 lane A, R3.16, O-301, O-302): the drill picker and its empty state, the
 * start request, one render per answer kind, the request each answer sends, the result view with
 * the unlock banner, the synthetic banner, the hotkeys, a 409 stale-state that reads the current
 * prompt again, and fixed problem text that never shows the server's detail. No rating, score or
 * grade label appears anywhere.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SYNTHETIC_TEXT } from "../../src/components/ui/index.js";
import type { PredictionPrompt } from "../../src/contracts.js";
import { FIXTURE_CSRF_TOKEN } from "../../src/fixtures/index.js";
import {
  FIXTURE_PREDICTION_DRILL_ID,
  fixtureDrillList,
  fixturePredictionPrompt,
  fixturePredictionResult,
  fixturePredictions,
} from "../../src/fixtures/prediction.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { ANSWER_PATH, DRILLS_PATH, NEXT_PATH, START_PATH, renderPredict } from "./render-predict.js";

const RUN_PATH = `/predict?drill=${FIXTURE_PREDICTION_DRILL_ID}`;
const SERVER_DETAIL = "server detail text";

function entryOf(kind: PredictionPrompt["answer_kind"]) {
  const entry = fixturePredictions.find((item) => item.prompt.answer_kind === kind);
  if (entry === undefined) throw new Error(`no fixture for ${kind}`);
  return entry;
}

async function question(kind: PredictionPrompt["answer_kind"]): Promise<HTMLElement> {
  return screen.findByRole("heading", { name: fixturePredictionPrompt(kind).question });
}

describe("R3.16 /predict drill picker", () => {
  it("R3.16 lists the user's drills as links that start a prediction session", async () => {
    const view = renderPredict("/predict", { [DRILLS_PATH]: [jsonResponse(200, fixtureDrillList)] });
    const link = await screen.findByRole("link", { name: fixtureDrill.name });
    expect(link).toHaveAttribute("href", `/predict?drill=${fixtureDrill.id}`);
    expect(view.sentTo(START_PATH)).toHaveLength(0);
  });

  it("R3.16 the empty state says to create a drill in Drills", async () => {
    renderPredict("/predict", { [DRILLS_PATH]: [jsonResponse(200, { items: [], next_cursor: null })] });
    expect(await screen.findByText(/You have no drills yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Drills" })).toHaveAttribute("href", "/drills");
  });

  it("R3.16 a failed drill read shows fixed text, never the server's detail", async () => {
    renderPredict("/predict", { [DRILLS_PATH]: [problemResponse(503, "unavailable")] });
    expect(await screen.findByRole("alert")).toHaveTextContent("The solver service did not answer");
    expect(screen.queryByText(SERVER_DETAIL)).not.toBeInTheDocument();
  });
});

describe("R3.16 /predict session start", () => {
  it("R3.16 starts a prediction session with the drill, the seed, the csrf token and an Idempotency-Key", async () => {
    const view = renderPredict(`${RUN_PATH}&seed=00000000deadbeef`, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("yes_no"))] });
    await question("yes_no");
    const [start] = view.sentTo(START_PATH);
    expect(start?.body).toEqual({ mode: "prediction", drill_id: FIXTURE_PREDICTION_DRILL_ID, seed: "00000000deadbeef" });
    expect(start?.csrf).toBe(FIXTURE_CSRF_TOKEN);
    expect(start?.idempotencyKey).not.toBeNull();
    expect(view.sentTo(START_PATH)).toHaveLength(1);
  });

  it("R3.16 a start refused by the api shows the fixed text of its problem kind", async () => {
    renderPredict(RUN_PATH, { [START_PATH]: [problemResponse(422, "no-coverage")] });
    expect(await screen.findByRole("alert")).toHaveTextContent("The library does not cover this drill's spots yet");
    expect(screen.queryByText(SERVER_DETAIL)).not.toBeInTheDocument();
  });
});

describe("R3.16 /predict renders each answer kind", () => {
  it("R3.16 yes or no: a level badge, the spot and Yes and No buttons", async () => {
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("yes_no"))] });
    await question("yes_no");
    expect(screen.getByTestId("level-badge")).toHaveTextContent("Range level 1 of 3");
    expect(screen.getByText("BTN Raise to 2.5bb")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Your answer" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Yes", "No"]);
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
  });

  it("R3.16 percent: a number field from 0 to 100 in steps of 5", async () => {
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("percent"))] });
    await question("percent");
    const field = screen.getByRole("spinbutton", { name: "Share of the range, in percent" });
    expect(field).toHaveAttribute("min", "0");
    expect(field).toHaveAttribute("max", "100");
    expect(field).toHaveAttribute("step", "5");
  });

  it("R3.16 regions: one checkbox per region", async () => {
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("regions"))] });
    await question("regions");
    expect(screen.getAllByRole("checkbox")).toHaveLength(8);
    expect(screen.getByRole("checkbox", { name: "Suited connectors" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeEnabled();
  });

  it("R3.16 action: the node's actions as buttons with a swatch, and the hand", async () => {
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("action"))] });
    await question("action");
    const group = screen.getByRole("group", { name: "Most frequent action" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["FFold", "CCall", "RRaise to 10bb", "RRaise to 25bb"]);
    expect(within(group).getAllByTestId("action-swatch")).toHaveLength(4);
    expect(screen.getByText("A5s")).toBeInTheDocument();
  });

  it("R3.16 band: the four frequency bands", async () => {
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("band"))] });
    await question("band");
    const group = screen.getByRole("group", { name: "Frequency band" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "0 to 25 percent",
      "25 to 50 percent",
      "50 to 75 percent",
      "75 to 100 percent",
    ]);
  });

  it("R3.16 size: only the aggressive actions", async () => {
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("size"))] });
    await question("size");
    const group = screen.getByRole("group", { name: "Most frequent size" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["RRaise to 10bb", "RRaise to 25bb"]);
  });
});

describe("R3.16 /predict answers and results", () => {
  it("R3.16 submit sends the prompt id, state version and the yes or no answer, then shows the unlock", async () => {
    const entry = entryOf("yes_no");
    const result = fixturePredictionResult(entry, { kind: "yes_no", value: true }, 0);
    const view = renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, entry.prompt)], [ANSWER_PATH]: [jsonResponse(200, result)] });
    await question("yes_no");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByRole("button", { name: /Yes/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    const panel = await screen.findByTestId("prediction-result");
    const [answer] = view.sentTo(ANSWER_PATH);
    expect(answer?.body).toEqual({ prompt_id: entry.prompt.prompt_id, state_version: 0, answer: { kind: "yes_no", value: true } });
    expect(answer?.idempotencyKey).not.toBeNull();
    expect(answer?.csrf).toBe(FIXTURE_CSRF_TOKEN);
    expect(within(panel).getByRole("status")).toHaveTextContent("Correct");
    expect(within(panel).getByText(entry.truth.text)).toBeInTheDocument();
    expect(within(panel).getByTestId("level-unlocked")).toHaveTextContent("Next level unlocked: Range level 2 of 3");
    expect(within(panel).getByText(/18 correct of 20/)).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/rating|score|blunder|mistake|inaccuracy/i);
    expect(screen.getByRole("form").textContent).not.toMatch(/rating|score|blunder|mistake|inaccuracy/i);
  });

  it("R3.16 a wrong answer says so with a symbol and no unlock banner", async () => {
    const entry = entryOf("band");
    const result = fixturePredictionResult(entry, { kind: "band", band: "0_25" }, 3);
    const view = renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, { ...entry.prompt, state_version: 3 })], [ANSWER_PATH]: [jsonResponse(200, result)] });
    await question("band");
    await userEvent.click(screen.getByRole("button", { name: "0 to 25 percent" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    const panel = await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)[0]?.body).toMatchObject({ state_version: 3, answer: { kind: "band", band: "0_25" } });
    expect(within(panel).getByRole("status")).toHaveTextContent("✗ Not this time");
    expect(within(panel).queryByTestId("level-unlocked")).not.toBeInTheDocument();
  });

  it("R3.16 percent, regions, action and size answers send their contract shapes", async () => {
    const cases = [
      { kind: "percent" as const, act: () => userEvent.type(screen.getByRole("spinbutton"), "40"), answer: { kind: "percent", value: 40 } },
      {
        kind: "regions" as const,
        act: async () => {
          await userEvent.click(screen.getByRole("checkbox", { name: "Suited connectors" }));
          await userEvent.click(screen.getByRole("checkbox", { name: "Pairs" }));
          await userEvent.click(screen.getByRole("checkbox", { name: "Offsuit aces" }));
          await userEvent.click(screen.getByRole("checkbox", { name: "Offsuit aces" }));
        },
        answer: { kind: "regions", value: ["pairs", "suited_connectors"] },
      },
      { kind: "action" as const, act: () => userEvent.click(screen.getByRole("button", { name: /Raise to 10bb/ })), answer: { kind: "action", action_index: 2 } },
      { kind: "size" as const, act: () => userEvent.click(screen.getByRole("button", { name: /Raise to 25bb/ })), answer: { kind: "size", action_index: 3 } },
    ];
    for (const { kind, act, answer } of cases) {
      const entry = entryOf(kind);
      const result = fixturePredictionResult(entry, answer as never, 0);
      const view = renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, entry.prompt)], [ANSWER_PATH]: [jsonResponse(200, result)] });
      await question(kind);
      await act();
      await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
      await screen.findByTestId("prediction-result");
      expect(view.sentTo(ANSWER_PATH)[0]?.body, kind).toMatchObject({ answer });
      view.unmount();
    }
  });

  it("R3.16 Next reads the next prompt; Enter submits and N moves on", async () => {
    const first = entryOf("yes_no");
    const second = { ...fixturePredictionPrompt("action"), state_version: 1 };
    const view = renderPredict(RUN_PATH, {
      [NEXT_PATH]: [jsonResponse(200, first.prompt), jsonResponse(200, second)],
      [ANSWER_PATH]: [jsonResponse(200, fixturePredictionResult(first, { kind: "yes_no", value: false }, 0))],
    });
    await question("yes_no");
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    await userEvent.keyboard("{Enter}");
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
    await userEvent.keyboard("n");
    await question("action");
    expect(view.sentTo(NEXT_PATH)).toHaveLength(2);
    expect(screen.queryByTestId("prediction-result")).not.toBeInTheDocument();
  });

  it("R3.16 a 409 stale-state reads the current prompt again and says so", async () => {
    const stale = entryOf("yes_no").prompt;
    const current = { ...fixturePredictionPrompt("action"), state_version: 4 };
    const view = renderPredict(RUN_PATH, {
      [NEXT_PATH]: [jsonResponse(200, stale), jsonResponse(200, current)],
      [ANSWER_PATH]: [problemResponse(409, "stale-state")],
    });
    await question("yes_no");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await question("action");
    expect(screen.getByText(/This question moved on/)).toBeInTheDocument();
    expect(view.sentTo(NEXT_PATH)).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.16 another failed answer shows fixed text and keeps the prompt", async () => {
    const entry = entryOf("yes_no");
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, entry.prompt)], [ANSWER_PATH]: [problemResponse(409, "session-ended")] });
    await question("yes_no");
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This session has ended");
    expect(screen.queryByText(SERVER_DETAIL)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: entry.prompt.question })).toBeInTheDocument();
  });

  it("R3.16 the synthetic banner shows only for a synthetic solution", async () => {
    const { unmount } = renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, fixturePredictionPrompt("yes_no"))] });
    await question("yes_no");
    expect(screen.getByText(SYNTHETIC_TEXT)).toBeInTheDocument();
    unmount();
    renderPredict(RUN_PATH, { [NEXT_PATH]: [jsonResponse(200, { ...fixturePredictionPrompt("yes_no"), synthetic: false })] });
    await question("yes_no");
    await waitFor(() => expect(screen.queryByText(SYNTHETIC_TEXT)).not.toBeInTheDocument());
  });
});
