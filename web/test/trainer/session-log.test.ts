/**
 * The in-session log and tally (S46, R3.32, design rule 10, O-477, ADR 0004): every decision's
 * prompt and feedback kept by the session hook, and the tally over the served per-decision
 * numbers only (counts per label, rated count, total and mean EV loss, the run of Best or
 * Correct). Pure; nothing is derived from frequencies.
 */
import { describe, expect, it } from "vitest";

import type { DecisionFeedback, FeedbackLabel } from "../../src/contracts.js";
import { fixtureFeedback, fixturePrompt } from "../../src/fixtures/index.js";
import { fixturePracticeSession, fixtureRecap } from "../../src/fixtures/trainer.js";
import { EMPTY_LOG, RUN_PANEL_KEY, logAfter, recapTallyOf, runOf, showsRun, tallyOf, type DecisionEntry, type SessionLog } from "../../src/trainer/session-log.js";
import type { SessionContext, SpotState } from "../../src/trainer/spot-machine.js";

const CONTEXT: SessionContext = { session: fixturePracticeSession, rng: false, hand: { handNo: 0, ordinal: 1, decision: 1, stateVersion: 3, heroPosition: "BB" } };

function reveal(key: string, label: FeedbackLabel, evLoss: number, rated = false, ordinal = 1): SpotState {
  const feedback: DecisionFeedback = { ...fixtureFeedback, label, ev_loss_bb: evLoss, rated };
  const context: SessionContext = { ...CONTEXT, hand: { handNo: ordinal - 1, ordinal, decision: 1, stateVersion: 3, heroPosition: "BB" } };
  return { kind: "feedback", context, prompt: fixturePrompt, decision: { actionIndex: 1, responseMs: 50, idempotencyKey: key, stateVersion: 3 }, feedback };
}

function logOf(...states: readonly SpotState[]): SessionLog {
  return states.reduce<SessionLog>((log, state) => logAfter(log, state), EMPTY_LOG);
}

describe("R3.32 session log", () => {
  it("R3.32 a reveal adds one entry with its hand, prompt, chosen index and feedback, as a new log", () => {
    const log = logAfter(EMPTY_LOG, reveal("d1", "best", 0));
    expect(EMPTY_LOG.entries).toHaveLength(0);
    expect(log.entries).toHaveLength(1);
    const [entry] = log.entries as [DecisionEntry];
    expect(entry).toMatchObject({ key: "d1", actionIndex: 1, hand: { ordinal: 1, decision: 1 }, feedback: { label: "best" } });
    expect(entry.prompt).toBe(fixturePrompt);
  });

  it("R3.32 the same reveal seen twice (a re-render, a pause) is one entry; a later state keeps the log", () => {
    const first = reveal("d1", "best", 0);
    const log = logOf(first, first, { kind: "loading_prompt", context: CONTEXT, version: 4 }, reveal("d2", "blunder", 1.2, false, 2));
    expect(log.entries.map((entry) => entry.key)).toEqual(["d1", "d2"]);
  });

  it("R3.32 the log survives the recap and clears when a new session starts or the screen resets", () => {
    const played = logOf(reveal("d1", "best", 0));
    expect(logAfter(played, { kind: "ended", recap: fixtureRecap })).toBe(played);
    expect(logAfter(played, { kind: "ending", context: CONTEXT, key: "e" })).toBe(played);
    expect(logAfter(played, { kind: "starting", key: "s", rng: false })).toBe(EMPTY_LOG);
    expect(logAfter(played, { kind: "idle" })).toBe(EMPTY_LOG);
  });
});

describe("R3.32 session tally", () => {
  const ENTRIES = logOf(
    reveal("d1", "best", 0, true, 1),
    reveal("d2", "correct", 0.02, true, 2),
    reveal("d3", "inaccuracy", 0.011, false, 3),
    reveal("d4", "best", 0, true, 4),
    reveal("d5", "mistake", 0.4, true, 5),
  ).entries;

  it("R3.32 counts decisions, each label, the rated ones, and sums the served EV loss with its mean", () => {
    const tally = tallyOf(ENTRIES);
    expect(tally.decisions).toBe(5);
    expect(tally.counts).toEqual({ best: 2, correct: 1, inaccuracy: 1, mistake: 1, blunder: 0 });
    expect(tally.rated).toBe(4);
    expect(tally.evLossTotalBb).toBeCloseTo(0.431, 6);
    expect(tally.evLossMeanBb).toBeCloseTo(0.0862, 6);
  });

  it("R3.32 an empty session has zero everywhere and no mean", () => {
    expect(tallyOf([])).toEqual({
      decisions: 0,
      counts: { best: 0, correct: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      rated: 0,
      evLossTotalBb: 0,
      evLossMeanBb: null,
      run: 0,
    });
  });

  it("R3.32 the run counts Best or Correct decisions since the last other label, and is called a run", () => {
    expect(runOf(ENTRIES)).toBe(0);
    expect(runOf(ENTRIES.slice(0, 2))).toBe(2);
    expect(runOf(ENTRIES.slice(0, 4))).toBe(1);
    expect(tallyOf(ENTRIES.slice(0, 2)).run).toBe(2);
    expect(RUN_PANEL_KEY).toBe("streak_counter");
    expect(Object.keys(tallyOf([])).some((key) => /streak/i.test(key))).toBe(false);
  });

  it("R3.32 the run shows only when the prompt names the panel key (wire name streak_counter, O-377)", () => {
    expect(showsRun({ visible_panels: [RUN_PANEL_KEY] })).toBe(true);
    expect(showsRun({ visible_panels: ["hero_range_matrix"] })).toBe(false);
    expect(showsRun(null)).toBe(false);
  });
});

describe("R3.32 PR #50 review: the recap's label counts agree with the api's decisions", () => {
  it("R3.32 the recap gets the tally when the log saw every decision the api counted", () => {
    const log = logOf(reveal("d1", "best", 0), reveal("d2", "mistake", 0.2, false, 2), reveal("d3", "correct", 0.01, false, 3));
    expect(recapTallyOf({ ...fixtureRecap, decisions: 3 }, log.entries)).toEqual(tallyOf(log.entries));
  });

  it("R3.32 a decision the log never saw (its reveal lost) leaves the recap without label counts, never counts that add up wrong", () => {
    const log = logOf(reveal("d1", "best", 0), reveal("d2", "mistake", 0.2, false, 2));
    expect(recapTallyOf({ ...fixtureRecap, decisions: 3 }, log.entries)).toBeUndefined();
  });
});
