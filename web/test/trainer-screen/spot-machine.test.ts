/**
 * The spot-mode client state machine (S25, R3.13, O-284, O-345): every state against every event,
 * as a table. A row names a state, an event and the state kind it leads to; "same" means the event
 * is illegal there and transition returns the very same state object (ignored explicitly). S37
 * retired the confidence tap (O-345): choosing an action submits it, so await_confidence is gone.
 */
import { describe, expect, it } from "vitest";

import { fixtureFeedback } from "../../src/fixtures/index.js";
import { fixturePracticeSession, fixtureRecap, fixtureRngPrompt } from "../../src/fixtures/trainer.js";
import {
  INITIAL_SPOT_STATE,
  canEnd,
  transition,
  type PendingDecision,
  type ResponseTimer,
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
const TIMER: ResponseTimer = { shownAt: SHOWN_AT, pausedMs: 0, pausedSince: null };
const DECISION: PendingDecision = {
  actionIndex: CHOSEN,
  responseMs: COMMITTED_AT - SHOWN_AT,
  idempotencyKey: "decision-key-1",
  stateVersion: PROMPT.state_version,
};

const NETWORK: SpotProblem = { kind: "network", status: null };
const UNAVAILABLE: SpotProblem = { kind: "unavailable", status: 503 };
const STALE: SpotProblem = { kind: "stale", status: 409 };
const NO_COVERAGE: SpotProblem = { kind: "no_coverage", status: 422 };
const ENDED: SpotProblem = { kind: "session_ended", status: 409 };
const BAD_REQUEST: SpotProblem = { kind: "other", status: 400 };

const STATES: Readonly<Record<SpotStateKind, SpotState>> = {
  idle: INITIAL_SPOT_STATE,
  starting: { kind: "starting", key: "start-key", rng: true },
  loading_prompt: { kind: "loading_prompt", context: CONTEXT, version: PROMPT.state_version },
  stale: { kind: "stale", context: CONTEXT },
  await_action: { kind: "await_action", context: CONTEXT, prompt: PROMPT, timer: TIMER, notice: null },
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
  choose_action: { type: "choose_action", actionIndex: 1, at: COMMITTED_AT, key: "decision-key-2" },
  decision_succeeded: { type: "decision_succeeded", feedback: fixtureFeedback },
  next: { type: "next" },
  end: { type: "end", key: "end-key-2" },
  ended: { type: "ended", recap: fixtureRecap },
  failed: { type: "failed", problem: UNAVAILABLE },
  retry: { type: "retry" },
  reset: { type: "reset" },
  pause: { type: "pause", at: 2_000 },
  resume: { type: "resume", at: 2_500 },
};

type Expected = SpotStateKind | "same";
type Row = Readonly<Record<keyof typeof EVENTS, Expected>>;

const ALL_SAME: Row = Object.fromEntries(Object.keys(EVENTS).map((name) => [name, "same"]));

/** Rows: state -> event -> expected kind. Unlisted cells are "same". */
const TABLE: Readonly<Record<SpotStateKind, Row>> = {
  idle: { ...ALL_SAME, start: "starting" },
  starting: { ...ALL_SAME, session_started: "loading_prompt", failed: "error" },
  loading_prompt: { ...ALL_SAME, prompt_loaded: "await_action", end: "ending", failed: "error" },
  stale: { ...ALL_SAME, prompt_loaded: "await_action", end: "ending", failed: "error" },
  await_action: { ...ALL_SAME, choose_action: "submitting", end: "ending", pause: "await_action" },
  submitting: { ...ALL_SAME, decision_succeeded: "feedback", failed: "error" },
  feedback: { ...ALL_SAME, next: "loading_prompt", end: "ending" },
  ending: { ...ALL_SAME, ended: "ended", failed: "error" },
  ended: { ...ALL_SAME, reset: "idle" },
  error: { ...ALL_SAME, end: "ending", retry: "submitting" },
};

const ROWS = Object.entries(TABLE).flatMap(([kind, row]) =>
  Object.entries(row).map(([event, expected]) => [kind as SpotStateKind, event, expected] as const),
);

function startError(problem: SpotProblem): SpotState {
  return transition(STATES.starting, { type: "failed", problem });
}

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

  it("R3.13 no state before the decision response holds feedback", () => {
    for (const state of Object.values(STATES)) {
      if (state.kind === "feedback") continue;
      expect(state).not.toHaveProperty("feedback");
    }
  });

  it("R3.13 choosing an action submits it at once with the choice's key and response_ms from shown to the choice, with no confidence (O-345)", () => {
    const chosen = transition(STATES.await_action, { type: "choose_action", actionIndex: CHOSEN, at: COMMITTED_AT, key: "k1" });
    expect(chosen).toEqual({
      kind: "submitting",
      context: CONTEXT,
      prompt: PROMPT,
      decision: { actionIndex: CHOSEN, responseMs: 2_450, idempotencyKey: "k1", stateVersion: PROMPT.state_version },
    });
    expect(transition(chosen, { type: "choose_action", actionIndex: 0, at: 5_000, key: "k2" }), "a second choice while submitting is ignored").toBe(chosen);
  });

  it("R3.13 an action index that is not one of the prompt's buttons is rejected (O-198)", () => {
    const state = STATES.await_action;
    expect(transition(state, { type: "choose_action", actionIndex: 99, at: COMMITTED_AT, key: "k" })).toBe(state);
  });

  it("R3.13 a clock that runs backwards never gives a negative response time", () => {
    const chosen = transition(STATES.await_action, { type: "choose_action", actionIndex: CHOSEN, at: SHOWN_AT - 10, key: "k" });
    expect(chosen).toMatchObject({ decision: { responseMs: 0 } });
  });

  it("R3.13 time while the screen is paused (the explainer is open) does not count toward response_ms (O-284)", () => {
    const paused = transition(STATES.await_action, { type: "pause", at: 2_000 });
    expect(paused).toMatchObject({ timer: { shownAt: SHOWN_AT, pausedMs: 0, pausedSince: 2_000 } });
    expect(transition(paused, { type: "pause", at: 2_100 })).toBe(paused);
    const resumed = transition(paused, { type: "resume", at: 5_000 });
    expect(resumed).toMatchObject({ timer: { shownAt: SHOWN_AT, pausedMs: 3_000, pausedSince: null } });
    expect(transition(resumed, { type: "resume", at: 5_100 })).toBe(resumed);
    const chosen = transition(resumed, { type: "choose_action", actionIndex: CHOSEN, at: 6_000, key: "k" });
    expect(chosen).toMatchObject({ decision: { responseMs: 2_000 } });
  });

  it("R3.13 an action chosen while paused counts only the time before the pause", () => {
    const paused = transition(STATES.await_action, { type: "pause", at: 2_000 });
    const chosen = transition(paused, { type: "choose_action", actionIndex: CHOSEN, at: 9_000, key: "k" });
    expect(chosen).toMatchObject({ decision: { responseMs: 1_000 } });
  });

  it("R3.13 a retried decision after a network error or a 503 keeps its Idempotency-Key", () => {
    for (const problem of [NETWORK, UNAVAILABLE]) {
      const failed = transition(STATES.submitting, { type: "failed", problem });
      expect(failed).toMatchObject({ kind: "error", retry: "decision", problem });
      const retried = transition(failed, { type: "retry" });
      expect(retried).toEqual(STATES.submitting);
    }
  });

  it("R3.13 a fixed 4xx answer is not retried: the error offers no retry, End stays possible", () => {
    const failed = transition(STATES.submitting, { type: "failed", problem: BAD_REQUEST });
    expect(failed).toMatchObject({ kind: "error", retry: null });
    expect(transition(failed, { type: "retry" })).toBe(failed);
    expect(canEnd(failed)).toBe(true);
    expect(transition(failed, { type: "end", key: "k-end" })).toEqual({ kind: "ending", context: CONTEXT, key: "k-end" });
  });

  it("R3.13 a 409 stale decision goes to stale, which refetches the prompt and shows a notice", () => {
    const stale = transition(STATES.submitting, { type: "failed", problem: STALE });
    expect(stale).toEqual({ kind: "stale", context: CONTEXT });
    const loaded = transition(stale, { type: "prompt_loaded", prompt: PROMPT, at: 9 });
    expect(loaded).toMatchObject({ kind: "await_action", notice: "stale", timer: { shownAt: 9, pausedMs: 0, pausedSince: null } });
  });

  it("R3.13 feedback then next loads the next prompt by the feedback's state version (prefetch key)", () => {
    expect(transition(STATES.feedback, { type: "next" })).toEqual({
      kind: "loading_prompt",
      context: CONTEXT,
      version: fixtureFeedback.state_version,
    });
  });

  it("R3.13 a 422 no-coverage on start is an error with no retry; Start again sends a new key", () => {
    const failed = startError(NO_COVERAGE);
    expect(failed).toMatchObject({ kind: "error", retry: null, problem: NO_COVERAGE, context: null });
    expect(transition(failed, { type: "retry" })).toBe(failed);
    expect(transition(failed, EVENTS.end as SpotEvent)).toBe(failed);
    expect(canEnd(failed)).toBe(false);
    expect(transition(failed, { type: "start", key: "fresh", rng: true })).toEqual({ kind: "starting", key: "fresh", rng: true });
    expect(transition(failed, { type: "reset" })).toEqual(INITIAL_SPOT_STATE);
  });

  it("R3.13 Start after a transient start failure reuses the key with the same options and takes a new one when RNG changed", () => {
    const failed = startError(NETWORK);
    expect(failed).toMatchObject({ retry: "start", start: { key: "start-key", rng: true } });
    expect(transition(failed, { type: "retry" })).toEqual(STATES.starting);
    expect(transition(failed, { type: "start", key: "fresh", rng: true })).toEqual({ kind: "starting", key: "start-key", rng: true });
    expect(transition(failed, { type: "start", key: "fresh", rng: false })).toEqual({ kind: "starting", key: "fresh", rng: false });
  });

  it("R3.13 a failed prompt read retries the read without the cache version", () => {
    const failed = transition(STATES.loading_prompt, { type: "failed", problem: UNAVAILABLE });
    expect(failed).toMatchObject({ kind: "error", retry: "next" });
    expect(transition(failed, { type: "retry" })).toEqual({ kind: "loading_prompt", context: CONTEXT, version: null });
    expect(transition(failed, { type: "start", key: "k", rng: true })).toBe(failed);
  });

  it("R3.13 an ended session cannot be retried, but End fetches its recap", () => {
    const failed = transition(STATES.loading_prompt, { type: "failed", problem: ENDED });
    expect(failed).toMatchObject({ retry: null });
    expect(transition(failed, { type: "end", key: "k" })).toEqual({ kind: "ending", context: CONTEXT, key: "k" });
    expect(transition(STATES.submitting, { type: "failed", problem: ENDED })).toMatchObject({ retry: null });
  });

  it("R3.13 every End after a failed end reuses the stored key until the recap arrives", () => {
    const failed = transition(STATES.ending, { type: "failed", problem: NETWORK });
    expect(failed).toMatchObject({ kind: "error", retry: "end", key: "end-key" });
    expect(transition(failed, { type: "retry" })).toEqual(STATES.ending);
    expect(transition(failed, { type: "end", key: "another" })).toEqual(STATES.ending);
    const fixedFailure = transition(STATES.ending, { type: "failed", problem: BAD_REQUEST });
    expect(transition(fixedFailure, { type: "end", key: "another" })).toEqual(STATES.ending);
  });

  it("R3.13 end from any playing state carries the session and the new key; ended holds only the recap", () => {
    for (const kind of ["await_action", "feedback", "loading_prompt", "stale", "error"] as const) {
      expect(canEnd(STATES[kind])).toBe(true);
      expect(transition(STATES[kind], { type: "end", key: "k-end" })).toEqual({ kind: "ending", context: CONTEXT, key: "k-end" });
    }
    for (const kind of ["idle", "starting", "submitting", "ending", "ended"] as const) expect(canEnd(STATES[kind])).toBe(false);
    expect(transition(STATES.ending, { type: "ended", recap: fixtureRecap })).toEqual({ kind: "ended", recap: fixtureRecap });
  });
});
