/**
 * Where the quiz's Enter submits from (R3.16, R3.30, PR #45 review round 4 finding b, PR #49
 * review round 1). PR 45 let the quiz's Enter binding answer from any focused control, so Enter on
 * a focused End quiz button or a link submitted the answer and the control's own action never ran.
 * Enter now submits from the page body, the chosen option or a ticked region, or the percent field
 * (the form's submit gate, PR #49 rounds 3 to 5); Enter on an unchosen option or region picks it,
 * and every other focused control keeps its own Enter.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

const PERCENT = entryOf("percent");

/** The Enter presses that are not a plain Enter: a Shift, Ctrl, Alt or Meta chord, or an auto-repeat while Enter is held. */
const UNPLAIN_ENTERS = [
  { name: "Shift+Enter", init: { shiftKey: true } },
  { name: "Ctrl+Enter", init: { ctrlKey: true } },
  { name: "Alt+Enter", init: { altKey: true } },
  { name: "Meta+Enter", init: { metaKey: true } },
  { name: "a held Enter", init: { repeat: true } },
] as const;

/** The modifier chords alone, whose default the answer controls must leave to the browser and assistive technology. */
const SHORTCUT_ENTER_NAMES: ReadonlySet<string> = new Set(["Ctrl+Enter", "Alt+Enter", "Meta+Enter"]);

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Submit answer" });
}

/**
 * Enter on the target as a browser runs it, since jsdom and user-event skip part of it (user-event
 * drops the keypress under Ctrl and Alt): the keydown, then, unless a handler prevented its default,
 * the browser's own action (a button's click, or the implicit submit from a field, which clicks the
 * form's Submit button), then the keyup. Returns whether the default was prevented.
 */
function browserEnter(target: HTMLElement, init: KeyboardEventInit): boolean {
  const unprevented = fireEvent.keyDown(target, { key: "Enter", ...init });
  if (unprevented) fireEvent.click(target instanceof HTMLButtonElement ? target : submitButton());
  fireEvent.keyUp(target, { key: "Enter", ...init });
  return !unprevented;
}

describe("R3.16 the answer form submits only from the Submit button or a plain Enter (PR #49 rounds 3 and 4)", APP_SUITE, () => {
  it("R3.16 Shift, Ctrl, Alt, Meta or a held Enter in the percent field never submits; a plain Enter there does", async () => {
    const view = await startOn(PERCENT, { kind: "percent", value: 35 });
    const percent = screen.getByRole("spinbutton", { name: "Share of the range, in percent" });
    await userEvent.type(percent, "35");
    for (const { name, init } of UNPLAIN_ENTERS) {
      browserEnter(percent, init);
      expect(view.sentTo(ANSWER_PATH), name).toHaveLength(0);
    }
    expect(screen.queryByTestId("prediction-result")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
  });

  it("R3.16 a click on the Submit button still submits", async () => {
    const view = await startOn(PERCENT, { kind: "percent", value: 35 });
    await userEvent.type(screen.getByRole("spinbutton", { name: "Share of the range, in percent" }), "35");
    await userEvent.click(submitButton());
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
  });

  it("R3.16 a click on Submit still submits in a browser with no global SubmitEvent (PR #49 review round 5)", async () => {
    const view = await startOn(PERCENT, { kind: "percent", value: 35 });
    await userEvent.type(screen.getByRole("spinbutton", { name: "Share of the range, in percent" }), "35");
    vi.stubGlobal("SubmitEvent", undefined);
    try {
      await userEvent.click(submitButton());
    } finally {
      vi.unstubAllGlobals();
    }
    await screen.findByTestId("prediction-result");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
  });

  it("R3.16 Shift, Ctrl, Alt, Meta or a held Enter on an unticked region neither ticks it nor submits the form", async () => {
    const view = await startOn(REGIONS, { kind: "regions", value: ["pairs", "suited_aces"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Pairs" }));
    const suited = screen.getByRole("checkbox", { name: "Suited aces" });
    suited.focus();
    for (const { name, init } of UNPLAIN_ENTERS) {
      browserEnter(suited, init);
      expect(view.sentTo(ANSWER_PATH), name).toHaveLength(0);
      expect(screen.getByRole("checkbox", { name: "Suited aces" }), name).not.toBeChecked();
    }
    expect(screen.queryByTestId("prediction-result")).not.toBeInTheDocument();
  });

  it("R3.16 Shift, Ctrl, Alt, Meta or a held Enter on an option never submits, and Ctrl, Alt and Meta keep their default", async () => {
    const view = await startOn(ACTION, { kind: "action", action_index: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    for (const name of ["Call", "Raise to 10bb"]) {
      const option = screen.getByRole("button", { name });
      for (const entry of UNPLAIN_ENTERS) {
        const blocked = browserEnter(option, entry.init);
        if (SHORTCUT_ENTER_NAMES.has(entry.name)) expect(blocked, `${entry.name} on ${name} is the browser's`).toBe(false);
        expect(view.sentTo(ANSWER_PATH), `${entry.name} on ${name}`).toHaveLength(0);
      }
    }
    expect(screen.queryByTestId("prediction-result")).not.toBeInTheDocument();
  });

  it("R3.16 a checkbox that is not one of the answer's own never submits the form on Enter", async () => {
    const view = await startOn(REGIONS, { kind: "regions", value: ["pairs"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Pairs" }));
    const form = screen.getByRole("heading", { name: REGIONS.prompt.question }).closest("form");
    if (form === null) throw new Error("the prompt has no form");
    const stray = document.createElement("input");
    stray.type = "checkbox";
    form.append(stray);
    try {
      for (const init of [{}, ...UNPLAIN_ENTERS.map((entry) => entry.init)]) browserEnter(stray, init);
      expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
    } finally {
      stray.remove();
    }
  });
});
