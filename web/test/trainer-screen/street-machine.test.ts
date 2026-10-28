/**
 * The client state machine in street and full-hand modes (S26, R3.13, R3.14, O-312 to O-314): the
 * run settings ride from Start into the session context, each shown prompt advances the hand
 * progress, a reveal records whether it pauses, and auto_continue leaves only a reveal that does
 * not pause. Spot mode (no run settings, or after_action) behaves exactly as in S25.
 */
import { describe, expect, it, vi } from "vitest";

import type { DecisionFeedback, TrainerPrompt } from "../../src/contracts.js";
import {
  fixtureFullHandDrill,
  fixturePartCoverage,
  fixturePracticeSession,
  fixtureStreetDrill,
  fixtureStreetHands,
} from "../../src/fixtures/trainer.js";
import { runSettingsOf } from "../../src/trainer/pause-rule.js";
import type { RunSettings } from "../../src/trainer/session-types.js";
import { autoContinueDelay, transition, type SpotEvent, type SpotState } from "../../src/trainer/spot-machine.js";
import { defaultScheduler } from "../../src/trainer/trainer-deps.js";

const STREET: RunSettings = runSettingsOf(fixtureStreetDrill.trainer);
const NEVER: RunSettings = { ...STREET, pause: "never", speed: "slow", quick_result: true };
const [HAND] = fixtureStreetHands;
if (HAND === undefined) throw new Error("the street fixtures have no hand");
const FIRST: TrainerPrompt = { ...HAND.first.prompt, hand_no: 0, state_version: 1 };
const SECOND: TrainerPrompt = { ...HAND.second.prompt, hand_no: 0, state_version: 2 };
const BEST: DecisionFeedback = { ...HAND.first.feedback, label: "best", state_version: 2 };
const MISTAKE: DecisionFeedback = { ...HAND.second.feedback, label: "mistake", state_version: 3 };
const NEXT_HAND: TrainerPrompt = {
  ...FIRST,
  hand_no: 1,
  state_version: 3,
  previous_hand: { hand_no: 0, history: SECOND.history, board: [], end: "street_closed" },
};

function run(state: SpotState, ...events: readonly SpotEvent[]): SpotState {
  return events.reduce(transition, state);
}

function started(settings: RunSettings | undefined): SpotState {
  const start: SpotEvent = settings === undefined ? { type: "start", key: "k", rng: false } : { type: "start", key: "k", rng: false, trainer: settings };
  return run({ kind: "idle" }, start, { type: "session_started", session: { ...fixturePracticeSession, coverage: fixturePartCoverage } });
}

function decided(state: SpotState, prompt: TrainerPrompt, feedback: DecisionFeedback, at: number): SpotState {
  return run(
    state,
    { type: "prompt_loaded", prompt, at },
    { type: "choose_action", actionIndex: 1, at: at + 100, key: `key-${at}` },
    { type: "decision_succeeded", feedback },
  );
}

describe("R3.13 default automatic-continue timer", () => {
  it("R3.13 runs once after its delay, and not at all once cancelled", () => {
    vi.useFakeTimers();
    try {
      const ran = vi.fn();
      defaultScheduler(ran, 500);
      const cancel = defaultScheduler(ran, 500);
      cancel();
      vi.advanceTimersByTime(499);
      expect(ran).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(ran).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("R3.13 street and full-hand machine", () => {
  it("R3.13 the run settings ride from Start into the session context, with the coverage (O-312)", () => {
    const state = started(STREET);
    expect(state).toMatchObject({ kind: "loading_prompt", context: { trainer: STREET, session: { coverage: fixturePartCoverage } } });
  });

  it("R3.13 a transient start failure keeps the run settings for the retry", () => {
    const failed = run({ kind: "idle" }, { type: "start", key: "k", rng: false, trainer: STREET }, { type: "failed", problem: { kind: "network", status: null } });
    expect(transition(failed, { type: "retry" })).toEqual({ kind: "starting", key: "k", rng: false, trainer: STREET });
  });

  it("R3.13 a hand with two hero decisions stays one hand; the next hand carries the ended hand", () => {
    const first = run(started(STREET), { type: "prompt_loaded", prompt: FIRST, at: 0 });
    expect(first).toMatchObject({ kind: "await_action", context: { hand: { handNo: 0, decision: 1, endedHand: null } } });
    const second = run(decided(started(STREET), FIRST, BEST, 0), { type: "auto_continue" }, { type: "prompt_loaded", prompt: SECOND, at: 2_000 });
    expect(second).toMatchObject({ kind: "await_action", context: { hand: { handNo: 0, decision: 2, endedHand: null } } });
    const next = run(decided(second, SECOND, MISTAKE, 2_000), { type: "next" }, { type: "prompt_loaded", prompt: NEXT_HAND, at: 5_000 });
    expect(next).toMatchObject({
      kind: "await_action",
      context: { hand: { handNo: 1, decision: 1, endedHand: { hand: NEXT_HAND.previous_hand, heroPosition: "BTN" } } },
    });
  });

  it("R3.13 street mode with after_mistake: a best reveal continues after the fast delay, a mistake pauses (O-314)", () => {
    const best = decided(started(STREET), FIRST, BEST, 0);
    expect(best).toMatchObject({ kind: "feedback", autoContinueMs: 500 });
    expect(autoContinueDelay(best)).toBe(500);
    const mistake = decided(started(STREET), FIRST, MISTAKE, 0);
    expect(mistake).toMatchObject({ kind: "feedback", autoContinueMs: null });
    expect(autoContinueDelay(mistake)).toBeNull();
  });

  it("R3.13 full-hand mode with every_action pauses on every reveal", () => {
    const state = decided(started(runSettingsOf(fixtureFullHandDrill.trainer)), FIRST, BEST, 0);
    expect(state).toMatchObject({ kind: "feedback", autoContinueMs: null });
  });

  it("R3.13 never with quick_result halves the slow delay", () => {
    expect(autoContinueDelay(decided(started(NEVER), FIRST, MISTAKE, 0))).toBe(1_250);
  });

  it("R3.13 auto_continue leaves a reveal that does not pause, by its state version, and nothing else", () => {
    const best = decided(started(STREET), FIRST, BEST, 0);
    expect(transition(best, { type: "auto_continue" })).toMatchObject({ kind: "loading_prompt", version: BEST.state_version });
    const paused = decided(started(STREET), FIRST, MISTAKE, 0);
    expect(transition(paused, { type: "auto_continue" })).toBe(paused);
    const awaiting = run(started(STREET), { type: "prompt_loaded", prompt: FIRST, at: 0 });
    expect(transition(awaiting, { type: "auto_continue" })).toBe(awaiting);
    expect(autoContinueDelay(awaiting)).toBeNull();
  });

  it("R3.13 Next still leaves a reveal that would continue by itself", () => {
    const best = decided(started(STREET), FIRST, BEST, 0);
    expect(transition(best, { type: "next" })).toMatchObject({ kind: "loading_prompt" });
  });

  it("R3.13 spot mode is unchanged: no run settings means every reveal pauses and auto_continue is ignored", () => {
    for (const settings of [undefined, { ...STREET, stop_rule: "after_action" as const, pause: "never" as const }]) {
      const state = decided(started(settings), FIRST, BEST, 0);
      expect(state).toMatchObject({ kind: "feedback", autoContinueMs: null });
      expect(transition(state, { type: "auto_continue" })).toBe(state);
    }
  });
});
