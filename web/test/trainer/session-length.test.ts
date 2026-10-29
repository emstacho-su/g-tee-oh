/**
 * The planned session length (S46, R3.31, design rule 10, O-472): the choices, their labels, and
 * the machine selector that says a reveal is the session's last one in spot mode. Pure.
 */
import { describe, expect, it } from "vitest";

import { fixtureFeedback } from "../../src/fixtures/index.js";
import { fixturePracticeSession, fixtureRngPrompt } from "../../src/fixtures/trainer.js";
import { SESSION_LENGTHS, atSessionLimit, isSessionLength, sessionLengthLabel } from "../../src/trainer/session-length.js";
import type { PendingDecision, SessionContext, SpotState } from "../../src/trainer/spot-machine.js";

const DECISION: PendingDecision = { actionIndex: 2, responseMs: 100, idempotencyKey: "k", stateVersion: 3 };

function feedbackAt(ordinal: number, length: SessionContext["length"]): SpotState {
  const context: SessionContext = {
    session: fixturePracticeSession,
    rng: false,
    hand: { handNo: ordinal - 1, ordinal, decision: 1, stateVersion: 3, heroPosition: "BB" },
    ...(length === undefined ? {} : { length }),
  };
  return { kind: "feedback", context, prompt: fixtureRngPrompt, decision: DECISION, feedback: fixtureFeedback };
}

describe("R3.31 session length", () => {
  it("R3.31 the choices are Off, 10, 20 and 50 hands", () => {
    expect(SESSION_LENGTHS).toEqual([10, 20, 50]);
    for (const length of [null, 10, 20, 50]) expect(isSessionLength(length)).toBe(true);
    for (const wrong of [15, "10", undefined, 0, -10]) expect(isSessionLength(wrong)).toBe(false);
  });

  it("R3.31 a length reads as hands and null as Off", () => {
    expect(sessionLengthLabel(null)).toBe("Off");
    expect(sessionLengthLabel(10)).toBe("10 hands");
    expect(sessionLengthLabel(50)).toBe("50 hands");
  });

  it("R3.31 the reveal of the last planned hand is at the limit; earlier reveals and sessions without a length are not", () => {
    expect(atSessionLimit(feedbackAt(10, 10))).toBe(true);
    expect(atSessionLimit(feedbackAt(11, 10))).toBe(true);
    expect(atSessionLimit(feedbackAt(9, 10))).toBe(false);
    expect(atSessionLimit(feedbackAt(10, null))).toBe(false);
    expect(atSessionLimit(feedbackAt(10, undefined))).toBe(false);
  });

  it("R3.31 only a reveal can be at the limit", () => {
    const reveal = feedbackAt(10, 10);
    if (reveal.kind !== "feedback") throw new Error("not a reveal");
    const awaiting: SpotState = { kind: "await_action", context: reveal.context, prompt: reveal.prompt, timer: { shownAt: 0, pausedMs: 0, pausedSince: null }, notice: null };
    expect(atSessionLimit(awaiting)).toBe(false);
    expect(atSessionLimit({ kind: "idle" })).toBe(false);
  });
});

describe("R3.31 PR #45 review round 1, finding 1: the limit at a reveal is for one-decision hands only", () => {
  it.each(["end_of_street", "end_of_hand"] as const)("R3.31 a %s reveal on the last planned hand is not the limit; the next prompt decides", (stop_rule) => {
    const reveal = feedbackAt(10, 10);
    if (reveal.kind !== "feedback") throw new Error("not a reveal");
    const street: SpotState = { ...reveal, context: { ...reveal.context, trainer: { stop_rule, pause: "every_action", speed: "normal", quick_result: false } } };
    expect(atSessionLimit(street)).toBe(false);
  });

  it("R3.31 a spot-mode drill reveal (stop rule after_action) and an automated reveal (no run settings) are the limit", () => {
    const reveal = feedbackAt(10, 10);
    if (reveal.kind !== "feedback") throw new Error("not a reveal");
    const spot: SpotState = { ...reveal, context: { ...reveal.context, trainer: { stop_rule: "after_action", pause: "every_action", speed: "normal", quick_result: false } } };
    expect(atSessionLimit(spot)).toBe(true);
    expect(atSessionLimit(reveal)).toBe(true);
  });
});
