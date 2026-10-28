/**
 * The spot-mode client state machine (S25, R3.13, R3.11, O-284): every state against every event,
 * as a table. A row names a state, an event and the state kind it leads to; "same" means the event
 * is illegal there and transition returns the very same state object (ignored explicitly).
 */
import { describe, expect, it } from "vitest";

import { fixtureFeedback } from "../../src/fixtures/index.js";
import { fixturePracticeSession, fixtureRecap, fixtureRngPrompt } from "../../src/fixtures/trainer.js";
import {
  INITIAL_SPOT_STATE,
  transition,
  type PendingDecision,
  type SessionContext,
  type SpotEvent,
  type SpotProblem,
  type SpotState,
  type SpotStateKind,
} from "../../src/trainer/spot-machine.js";

const CONTEXT: SessionContext = { session: fixturePracticeSession, rng: true };
const PROMPT = fixtureRngPrompt;
const SHOWN_AT = 1_000;
const COMMITTED_AT = 3_450;
const CHOSEN = 2;
const DECISION: PendingDecision = {
  actionIndex: CHOSEN,
  confidence: "sure",
  responseMs: COMMITTED_AT - SHOWN_AT,
  idempotencyKey: "decision-key-1",
  stateVersion: PROMPT.state_version,
};

const NETWORK: SpotProblem = { kind: "network", status: null };
const UNAVAILABLE: SpotProblem = { kind: "unavailable", status: 503 };
const STALE: SpotProblem = { kind: "stale", status: 409 };
const NO_COVERAGE: SpotProblem = { kind: "no_coverage", status: 422 };
const ENDED: SpotProblem = { kind: "session_ended", status: 409 };

const STATES: Readonly<Record<SpotStateKind, SpotState>> = {
  idle: INITIAL_SPOT_STATE,
  starting: { kind: "starting", key: "start-key", rng: true },
  loading_prompt: { kind: "loading_prompt", context: CONTEXT, version: PROMPT.state_version },
  stale: { kind: "stale", context: CONTEXT },
  await_action: { kind: "await_action", context: CONTEXT, prompt: PROMPT, shownAt: SHOWN_AT, notice: null },
  await_confidence: {
    kind: "await_confidence",
    context: CONTEXT,
    prompt: PROMPT,
    shownAt: SHOWN_AT,
    actionIndex: CHOSEN,
    committedAt: COMMITTED_AT,
  },
  submitting: { kind: "submitting", context: CONTEXT, prompt: PROMPT, decision: DECISION },
  feedback: { kind: "feedback", context: CONTEXT, prompt: PROMPT, decision: DECISION, feedback: fixtureFeedback },
  ending: { kind: "ending", context: CONTEXT, key: "end-key" },
  ended: { kind: "ended", recap: fixtureRecap },
  error: {
    kind: "error",
    problem: UNAVAILABLE,
    retry: "decision",
    context: CONTEXT,
    prompt: PROMPT,
    decision: DECISION,
    start: null,
    key: null,
  },
};

const EVENTS: Readonly<Record<string, SpotEvent>> = {
  start: { type: "start", key: "start-key", rng: true },
  session_started: { type: "session_started", session: fixturePracticeSession },
  prompt_loaded: { type: "prompt_loaded", prompt: PROMPT, at: SHOWN_AT },
  choose_action: { type: "choose_action", actionIndex: 1, at: COMMITTED_AT },
  confidence: { type: "confidence", confidence: "unsure", key: "decision-key-2" },
  decision_succeeded: { type: "decision_succeeded", feedback: fixtureFeedback },
  next: { type: "next" },
  end: { type: "end", key: "end-key-2" },
  ended: { type: "ended", recap: fixtureRecap },
  failed: { type: "failed", problem: UNAVAILABLE },
  retry: { type: "retry" },
  reset: { type: "reset" },
};

type Expected = SpotStateKind | "same";

/** Rows: state -> event -> expected kind. Every cell of the grid is listed. */
const TABLE: Readonly<Record<SpotStateKind, Readonly<Record<keyof typeof EVENTS, Expected>>>> = {
  idle: { start: "starting", session_started: "same", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "same", ended: "same", failed: "same", retry: "same", reset: "same" },
  starting: { start: "same", session_started: "loading_prompt", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "same", ended: "same", failed: "error", retry: "same", reset: "same" },
  loading_prompt: { start: "same", session_started: "same", prompt_loaded: "await_action", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "ending", ended: "same", failed: "error", retry: "same", reset: "same" },
  stale: { start: "same", session_started: "same", prompt_loaded: "await_action", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "ending", ended: "same", failed: "error", retry: "same", reset: "same" },
  await_action: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "await_confidence", confidence: "same", decision_succeeded: "same", next: "same", end: "ending", ended: "same", failed: "same", retry: "same", reset: "same" },
  await_confidence: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "await_confidence", confidence: "submitting", decision_succeeded: "same", next: "same", end: "ending", ended: "same", failed: "same", retry: "same", reset: "same" },
  submitting: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "feedback", next: "same", end: "same", ended: "same", failed: "error", retry: "same", reset: "same" },
  feedback: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "loading_prompt", end: "ending", ended: "same", failed: "same", retry: "same", reset: "same" },
  ending: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "same", ended: "ended", failed: "error", retry: "same", reset: "same" },
  ended: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "same", ended: "same", failed: "same", retry: "same", reset: "idle" },
  error: { start: "same", session_started: "same", prompt_loaded: "same", choose_action: "same", confidence: "same", decision_succeeded: "same", next: "same", end: "ending", ended: "same", failed: "same", retry: "submitting", reset: "same" },
};

const ROWS = Object.entries(TABLE).flatMap(([kind, row]) =>
  Object.entries(row).map(([event, expected]) => [kind as SpotStateKind, event, expected] as const),
);

describe("R3.13 spot machine transition table", () => {
  it.each(ROWS)("R3.13 %s + %s -> %s", (kind, eventName, expected) => {
    const state = STATES[kind];
    const event = EVENTS[eventName] as SpotEvent;
    const next = transition(state, event);
    if (expected === "same") expect(next).toBe(state);
    else expect(next.kind).toBe(expected);
  });
});

describe("R3.13 spot machine rules", () => {
  it("R3.13 starts idle and keeps the start key and the RNG choice in starting", () => {
    expect(INITIAL_SPOT_STATE).toEqual({ kind: "idle" });
    expect(transition(INITIAL_SPOT_STATE, EVENTS.start as SpotEvent)).toEqual({ kind: "starting", key: "start-key", rng: true });
  });

  it("R3.13 a started session loads its first prompt by the session's state version, with the RNG choice", () => {
    const next = transition(STATES.starting, EVENTS.session_started as SpotEvent);
    expect(next).toEqual({
      kind: "loading_prompt",
      context: { session: fixturePracticeSession, rng: true },
      version: fixturePracticeSession.state_version,
    });
  });

  it("R3.11 no state before the decision response holds feedback", () => {
    for (const state of Object.values(STATES)) {
      if (state.kind === "feedback") continue;
      expect(state).not.toHaveProperty("feedback");
    }
  });

  it("R3.11 the decision is pending only after the confidence tap, with response_ms from shown to committed (O-284)", () => {
    const chosen = transition(STATES.await_action, { type: "choose_action", actionIndex: CHOSEN, at: COMMITTED_AT });
    expect(chosen.kind).toBe("await_confidence");
    expect(chosen).not.toHaveProperty("decision");
    const tapped = transition(chosen, { type: "confidence", confidence: "sure", key: "k1" });
    expect(tapped).toEqual({
      kind: "submitting",
      context: CONTEXT,
      prompt: PROMPT,
      decision: { actionIndex: CHOSEN, confidence: "sure", responseMs: 2_450, idempotencyKey: "k1", stateVersion: PROMPT.state_version },
    });
  });

  it("R3.11 choosing another action before the tap replaces the choice and its commit time", () => {
    const replaced = transition(STATES.await_confidence, { type: "choose_action", actionIndex: 0, at: 5_000 });
    expect(replaced).toMatchObject({ kind: "await_confidence", actionIndex: 0, committedAt: 5_000, shownAt: SHOWN_AT });
  });

  it("R3.13 an action index that is not one of the prompt's buttons is rejected (O-198)", () => {
    const state = STATES.await_action;
    expect(transition(state, { type: "choose_action", actionIndex: 99, at: COMMITTED_AT })).toBe(state);
  });

  it("R3.13 a clock that runs backwards never gives a negative response time", () => {
    const chosen = transition(STATES.await_action, { type: "choose_action", actionIndex: CHOSEN, at: SHOWN_AT - 10 });
    const tapped = transition(chosen, { type: "confidence", confidence: "sure", key: "k" });
    expect(tapped).toMatchObject({ decision: { responseMs: 0 } });
  });

  it("R3.13 a retried decision after a network error or a 503 keeps its Idempotency-Key", () => {
    for (const problem of [NETWORK, UNAVAILABLE]) {
      const failed = transition(STATES.submitting, { type: "failed", problem });
      expect(failed).toMatchObject({ kind: "error", retry: "decision", problem });
      const retried = transition(failed, { type: "retry" });
      expect(retried).toEqual(STATES.submitting);
    }
  });

  it("R3.13 a 409 stale decision goes to stale, which refetches the prompt and shows a notice", () => {
    const stale = transition(STATES.submitting, { type: "failed", problem: STALE });
    expect(stale).toEqual({ kind: "stale", context: CONTEXT });
    const loaded = transition(stale, { type: "prompt_loaded", prompt: PROMPT, at: 9 });
    expect(loaded).toMatchObject({ kind: "await_action", notice: "stale", shownAt: 9 });
  });

  it("R3.13 feedback then next loads the next prompt by the feedback's state version (prefetch key)", () => {
    expect(transition(STATES.feedback, { type: "next" })).toEqual({
      kind: "loading_prompt",
      context: CONTEXT,
      version: fixtureFeedback.state_version,
    });
  });

  it("R3.13 a 422 no-coverage on start is an error with no retry and reset goes back to the start panel", () => {
    const failed = transition(STATES.starting, { type: "failed", problem: NO_COVERAGE });
    expect(failed).toMatchObject({ kind: "error", retry: null, problem: NO_COVERAGE, context: null });
    expect(transition(failed, { type: "reset" })).toEqual(INITIAL_SPOT_STATE);
    expect(transition(failed, { type: "retry" })).toBe(failed);
    expect(transition(failed, EVENTS.end as SpotEvent)).toBe(failed);
  });

  it("R3.13 a failed start that can be retried keeps its key and RNG choice", () => {
    const failed = transition(STATES.starting, { type: "failed", problem: NETWORK });
    expect(failed).toMatchObject({ retry: "start", start: { key: "start-key", rng: true } });
    expect(transition(failed, { type: "retry" })).toEqual(STATES.starting);
  });

  it("R3.13 a failed prompt read retries the read without the cache version", () => {
    const failed = transition(STATES.loading_prompt, { type: "failed", problem: UNAVAILABLE });
    expect(failed).toMatchObject({ kind: "error", retry: "next" });
    expect(transition(failed, { type: "retry" })).toEqual({ kind: "loading_prompt", context: CONTEXT, version: null });
  });

  it("R3.13 an ended session cannot be retried and the error offers no retry", () => {
    const failed = transition(STATES.loading_prompt, { type: "failed", problem: ENDED });
    expect(failed).toMatchObject({ retry: null });
    const decisionFailed = transition(STATES.submitting, { type: "failed", problem: ENDED });
    expect(decisionFailed).toMatchObject({ retry: null });
  });

  it("R3.13 a failed end keeps its key for the retry", () => {
    const failed = transition(STATES.ending, { type: "failed", problem: NETWORK });
    expect(failed).toMatchObject({ kind: "error", retry: "end", key: "end-key" });
    expect(transition(failed, { type: "retry" })).toEqual(STATES.ending);
  });

  it("R3.13 end from any playing state carries the session and the new key; ended holds only the recap", () => {
    for (const kind of ["await_action", "await_confidence", "feedback", "loading_prompt", "stale", "error"] as const) {
      expect(transition(STATES[kind], { type: "end", key: "k-end" })).toEqual({ kind: "ending", context: CONTEXT, key: "k-end" });
    }
    expect(transition(STATES.ending, { type: "ended", recap: fixtureRecap })).toEqual({ kind: "ended", recap: fixtureRecap });
  });
});
