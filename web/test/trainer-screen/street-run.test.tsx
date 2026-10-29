/**
 * The drill run screen in street and full-hand modes (S26, R3.13, R3.14, O-312 to O-314), over the
 * scripted fake fetch with an injected timer: two hero decisions in one hand keep the hand number,
 * the next hand starts with no summary of the last one (S40, O-352: the api logs it), a reveal that does
 * not pause shows the result chip and continues after its delay but never while a dialog is open,
 * and the covered-part notes show on a partly covered or a refused start.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { DecisionFeedback, TrainerPrompt } from "../../src/contracts.js";
import {
  FIXTURE_DRILL_ID,
  fixtureDrill,
  fixtureFullHandDrill,
  fixturePartCoverage,
  fixturePracticeSession,
  fixtureStreetDrill,
  fixtureStreetHands,
} from "../../src/fixtures/trainer.js";
import type { Drill } from "../../src/trainer/session-types.js";
import type { Scheduler } from "../../src/trainer/trainer-deps.js";
import { jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { DECIDE_PATH, DRILL_PATH, NEXT_PATH, START_PATH, renderRun, type RunView } from "./render-run.js";
import { LIBRARY_MARKER_ID } from "./screen-router.js";

const [HAND] = fixtureStreetHands;
if (HAND === undefined) throw new Error("the street fixtures have no hand");
const START_VERSION = fixturePracticeSession.state_version;

const FIRST: TrainerPrompt = { ...HAND.first.prompt, hand_no: 0, state_version: START_VERSION };
const BEST: DecisionFeedback = { ...HAND.first.feedback, label: "best", ev_loss_bb: 0, state_version: START_VERSION + 1 };
const SECOND: TrainerPrompt = { ...HAND.second.prompt, hand_no: 0, state_version: START_VERSION + 1 };
const MISTAKE: DecisionFeedback = { ...HAND.second.feedback, state_version: START_VERSION + 2 };
const ENDED_HISTORY = [...SECOND.history, { position: "BTN" as const, token: "r2200", label: "Raise to 22bb" }, HAND.closing];

function nextHand(board: readonly string[]): TrainerPrompt {
  return {
    ...FIRST,
    hand_no: 1,
    state_version: START_VERSION + 2,
    previous_hand: { hand_no: 0, history: ENDED_HISTORY, board: [...board], end: "street_closed" },
  };
}

interface Timer {
  readonly run: () => void;
  readonly delayMs: number;
  cancelled: boolean;
}

/** An injected timer that records what the screen scheduled; a test fires it by hand. */
function fakeTimers(): { timers: Timer[]; schedule: Scheduler } {
  const timers: Timer[] = [];
  const schedule: Scheduler = (run, delayMs) => {
    const timer: Timer = { run, delayMs, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return { timers, schedule };
}

function script(drill: Drill, board: readonly string[] = []) {
  return {
    [DRILL_PATH]: [jsonResponse(200, { ...drill, id: FIXTURE_DRILL_ID })],
    [START_PATH]: [jsonResponse(201, { ...fixturePracticeSession, coverage: fixturePartCoverage })],
    [NEXT_PATH]: [jsonResponse(200, FIRST), jsonResponse(200, SECOND), jsonResponse(200, nextHand(board))],
    [DECIDE_PATH]: [jsonResponse(200, BEST), jsonResponse(200, MISTAKE)],
  };
}

async function start(drill: Drill): Promise<void> {
  await screen.findByRole("heading", { name: drill.name });
  await userEvent.click(screen.getByRole("button", { name: "Start session" }));
  await screen.findByRole("group", { name: "Actions" });
}

async function decide(action: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: action }));
}

async function counterReads(text: string): Promise<void> {
  expect(await screen.findByText(text)).toHaveAttribute("data-testid", "hand-counter");
}

describe("R3.13 street mode on the run screen", () => {
  it("R3.13 two hero decisions stay one hand; the next hand starts with no summary of the last (S40, O-352)", async () => {
    const { timers, schedule } = fakeTimers();
    renderRun({ script: script(fixtureStreetDrill), schedule });
    await start(fixtureStreetDrill);
    await counterReads("Hand 1, decision 1");
    await decide("Raise to 2.5bb");
    expect(await screen.findByTestId("result-chip")).toHaveTextContent("Best");
    expect(screen.queryByTestId("feedback-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next hand/ })).toBeEnabled();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({ delayMs: 500, cancelled: false });
    act(() => timers[0]?.run());
    await counterReads("Hand 1, decision 2");
    expect(screen.queryByTestId("hand-summary")).not.toBeInTheDocument();
    await decide("Raise to 22bb");
    expect(await screen.findByTestId("feedback-panel")).toBeInTheDocument();
    expect(timers).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await counterReads("Hand 2, decision 1");
    // The ended hand is logged by the api (hand_record), never shown (O-352).
    expect(screen.queryByTestId("hand-summary")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /ended/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ended when the street closed/)).not.toBeInTheDocument();
  });

  it("R3.13 the automatic continue waits while a dialog is open and is cancelled on unmount", async () => {
    const { timers, schedule } = fakeTimers();
    const view: RunView = renderRun({ script: script(fixtureStreetDrill), schedule });
    await start(fixtureStreetDrill);
    await decide("Raise to 2.5bb");
    await screen.findByTestId("result-chip");
    await userEvent.keyboard("{Shift>}e{/Shift}");
    await screen.findByRole("dialog", { name: "End this session?" });
    expect(timers[0]?.cancelled).toBe(true);
    expect(timers).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(timers).toHaveLength(2);
    expect(timers[1]?.cancelled).toBe(false);
    view.unmount();
    expect(timers[1]?.cancelled).toBe(true);
  });

  it("R3.13 Next leaves the result chip at once and cancels the timer", async () => {
    const { timers, schedule } = fakeTimers();
    renderRun({ script: script(fixtureStreetDrill), schedule });
    await start(fixtureStreetDrill);
    await decide("Raise to 2.5bb");
    await screen.findByTestId("result-chip");
    await userEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await counterReads("Hand 1, decision 2");
    expect(timers[0]?.cancelled).toBe(true);
  });
});

describe("R3.13 full-hand mode on the run screen", () => {
  it("R3.13 every reveal pauses, and the next hand starts with no summary or flop of the last (S40, O-352)", async () => {
    const { timers, schedule } = fakeTimers();
    renderRun({ script: script(fixtureFullHandDrill, HAND.flop), schedule });
    await start(fixtureFullHandDrill);
    await decide("Raise to 2.5bb");
    expect(await screen.findByTestId("feedback-panel")).toBeInTheDocument();
    expect(timers).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await counterReads("Hand 1, decision 2");
    await decide("Raise to 22bb");
    await screen.findByTestId("feedback-panel");
    await userEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await counterReads("Hand 2, decision 1");
    expect(screen.queryByTestId("hand-summary")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Hand 1 flop" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ended at the flop/)).not.toBeInTheDocument();
  });
});

describe("R3.14 covered part on the run screen", () => {
  it("R3.14 a partly covered drill runs and says how much is missing, with a library link (O-312)", async () => {
    renderRun({ script: script(fixtureDrill) });
    await start(fixtureDrill);
    const note = screen.getByTestId("coverage-note");
    expect(note).toHaveTextContent("Running on 2 of 3 spots; 1 queued for the builder");
    expect(within(note).getByRole("link", { name: "Open the library" })).toHaveAttribute("href", "/library");
    expect(screen.queryByTestId("hand-counter")).not.toBeInTheDocument();
  });

  it("R3.14 review MEDIUM 4: the run screen's library link is taken by the router, not a page load", async () => {
    const { router } = renderRun({ script: script(fixtureDrill) });
    await start(fixtureDrill);
    const link = within(screen.getByTestId("coverage-note")).getByRole("link", { name: "Open the library" });
    expect(fireEvent.click(link)).toBe(false);
    expect(await screen.findByTestId(LIBRARY_MARKER_ID)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/library");
  });

  it("R3.14 a fully uncovered drill names the queued count from the 422's typed pairs_total and pairs_queued and links to the library", async () => {
    const detail = "This drill cannot be dealt: the library covers none of this drill's spots.";
    renderRun({ script: { [START_PATH]: [problemResponse(422, "no-coverage", detail, { pairs_total: 4, pairs_queued: 4 })] } });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    const note = await screen.findByTestId("no-coverage-note");
    expect(note).toHaveTextContent("4 of this drill's 4 spots were queued for the builder");
    expect(screen.getByRole("alert")).not.toHaveTextContent("cannot be dealt");
  });
});

describe("R3.13 start panel pause rule", () => {
  it.each([
    // Worded as the builder's Pause field (src/drills/labels.ts, LOW 10); spot mode always pauses.
    [fixtureStreetDrill, "After a mistake"],
    [fixtureFullHandDrill, "After every action"],
    [{ ...fixtureDrill, trainer: { ...fixtureDrill.trainer, pause: "never" as const } }, "After every action"],
  ] as const)("R3.13 %#: the start panel shows the reveal rule", async (drill, text) => {
    renderRun({ script: script(drill) });
    await screen.findByRole("heading", { name: drill.name });
    expect(screen.getByTestId("pause-rule")).toHaveTextContent(text);
  });
});
