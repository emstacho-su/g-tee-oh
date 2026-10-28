/**
 * Tests for the pure replay plan of opponent actions on the table (S38, R3.13, O-381, O-382):
 * which history entries replay, how long each step takes, the 2.5 s cap and the speed scale, and
 * the per-seat view after some steps. Nothing is derived beyond the api's entries (ADR 0004).
 */
import { describe, expect, it } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixturePrompt } from "../../src/fixtures/index.js";
import {
  REPLAY_TIMING,
  SPEED_SCALE,
  logLines,
  planReplay,
  replayKey,
  seatActions,
  stepDurations,
} from "../../src/trainer/action-replay.js";

type Entry = TrainerPrompt["history"][number];

const fold = (position: Entry["position"]): Entry => ({ position, token: "f", label: "Fold" });
const raise = (position: Entry["position"], size: number): Entry => ({ position, token: `r${size}`, label: `Raise ${size / 100}bb` });
const call = (position: Entry["position"]): Entry => ({ position, token: "c", label: "Call" });

function promptWith(overrides: Partial<TrainerPrompt>): TrainerPrompt {
  return { ...fixturePrompt, ...overrides };
}

describe("R3.13 planReplay (O-382)", () => {
  it("R3.13 a first prompt replays its whole dealt line", () => {
    const plan = planReplay(null, fixturePrompt, "normal");
    expect(plan.firstNew).toBe(0);
    expect(plan.steps.map((step) => step.position)).toEqual(["UTG", "HJ", "CO"]);
    expect(plan.key).toBe(replayKey(fixturePrompt));
  });

  it("R3.13 a new hand replays its whole line even when the previous hand shared a prefix", () => {
    const previous = promptWith({ hand_no: 1, state_version: 5, history: [fold("UTG")] });
    const next = promptWith({ hand_no: 2, state_version: 6, history: [fold("UTG"), raise("HJ", 250)] });
    expect(planReplay(previous, next, "normal").firstNew).toBe(0);
  });

  it("R3.13 a continuing hand replays only the entries added since the last prompt", () => {
    const previous = promptWith({ hand_no: 4, state_version: 7, history: [fold("UTG"), raise("HJ", 250)] });
    const next = promptWith({ hand_no: 4, state_version: 8, history: [fold("UTG"), raise("HJ", 250), call("BTN"), call("BB")] });
    const plan = planReplay(previous, next, "normal");
    expect(plan.firstNew).toBe(2);
    expect(plan.steps.map((step) => step.position)).toEqual(["BTN", "BB"]);
  });

  it("R3.13 another session's prompt, or a history that is not a continuation, replays from the start", () => {
    const previous = promptWith({ hand_no: 4, history: [fold("UTG")] });
    expect(planReplay(previous, promptWith({ hand_no: 4, session_id: "00000000-0000-4000-8000-00000000ffff", history: [fold("UTG"), call("HJ")] }), "normal").firstNew).toBe(0);
    expect(planReplay(previous, promptWith({ hand_no: 4, state_version: 9, history: [call("UTG"), call("HJ")] }), "normal").firstNew).toBe(0);
  });

  it("R3.13 the same session and state version is the same plan key, so it never replays twice", () => {
    expect(replayKey(fixturePrompt)).toBe(replayKey({ ...fixturePrompt, pot_cbb: 999 }));
    expect(replayKey(fixturePrompt)).not.toBe(replayKey({ ...fixturePrompt, state_version: fixturePrompt.state_version + 1 }));
  });
});

describe("R3.13 stepDurations (O-381)", () => {
  it("R3.13 a fold takes 200 ms and any other action 500 ms at normal speed", () => {
    expect(REPLAY_TIMING).toEqual({ foldMs: 200, actionMs: 500, capMs: 2500 });
    expect(stepDurations([fold("UTG"), raise("HJ", 250), call("BB")], "normal")).toEqual([200, 500, 500]);
  });

  it("R3.13 slow scales by 1.5 and fast by 0.5", () => {
    expect(SPEED_SCALE).toEqual({ slow: 1.5, normal: 1, fast: 0.5 });
    expect(stepDurations([fold("UTG"), raise("HJ", 250)], "slow")).toEqual([300, 750]);
    expect(stepDurations([fold("UTG"), raise("HJ", 250)], "fast")).toEqual([100, 250]);
  });

  it("R3.13 a long line is capped at 2.5 s (scaled by speed) by shortening every step evenly", () => {
    const line = [raise("UTG", 250), call("UTG1"), call("UTG2"), call("LJ"), call("HJ"), call("CO"), fold("BTN"), fold("SB")];
    const normal = stepDurations(line, "normal");
    expect(normal.reduce((sum, ms) => sum + ms, 0)).toBeCloseTo(2500);
    expect(normal[0]! / normal[6]!).toBeCloseTo(500 / 200);
    const slow = stepDurations(line, "slow");
    expect(slow.reduce((sum, ms) => sum + ms, 0)).toBeCloseTo(3750);
  });

  it("R3.13 an empty line takes no time", () => {
    expect(stepDurations([], "normal")).toEqual([]);
  });
});

describe("R3.13 seatActions and logLines (O-383)", () => {
  const history = [fold("UTG"), raise("HJ", 250), fold("CO"), call("BTN")];

  it("R3.13 each seat shows its last shown action; folds fold the seat; only money actions get a chip", () => {
    const shown = seatActions(history, 2);
    expect(shown.get("UTG")).toEqual({ label: "Fold", folded: true, chip: null });
    expect(shown.get("HJ")).toEqual({ label: "Raise 2.5bb", folded: false, chip: "Raise 2.5bb" });
    expect(shown.has("CO")).toBe(false);
    const all = seatActions(history, 4);
    expect(all.get("BTN")).toEqual({ label: "Call", folded: false, chip: "Call" });
    expect(all.get("CO")?.folded).toBe(true);
  });

  it("R3.13 a full-hand flop prompt clears the preflop bets and badges, and folds stay folded (review round 1)", () => {
    const pre = (entry: Entry): Entry => ({ ...entry, street: "preflop" });
    const flopCheck: Entry = { position: "BB", token: "x", label: "Check", street: "flop" };
    const handHistory: Entry[] = [pre(fold("UTG")), pre(raise("BTN", 250)), pre(call("BB")), flopCheck];
    // Mid-replay, still preflop: the open and the call sit at the bet spots.
    const preflop = seatActions(handHistory, 3);
    expect(preflop.get("BTN")).toEqual({ label: "Raise 2.5bb", folded: false, chip: "Raise 2.5bb" });
    expect(preflop.get("BB")).toEqual({ label: "Call", folded: false, chip: "Call" });
    // The flop's first action starts a new street: the pot holds the preflop chips, so no seat
    // keeps a preflop chip or badge, and the preflop fold still folds UTG.
    const flop = seatActions(handHistory, 4);
    expect(flop.get("BTN")).toBeUndefined();
    expect(flop.get("BB")).toEqual({ label: "Check", folded: false, chip: null });
    expect(flop.get("UTG")).toEqual({ label: "Fold", folded: true, chip: null });
  });

  it("R3.13 entries without a street (stored before review round 1) stay one street", () => {
    expect(seatActions(history, 4).get("HJ")).toEqual({ label: "Raise 2.5bb", folded: false, chip: "Raise 2.5bb" });
  });

  it("R3.13 a check shows a badge and no chip", () => {
    expect(seatActions([{ position: "BB", token: "x", label: "Check" }], 1).get("BB")).toEqual({ label: "Check", folded: false, chip: null });
  });

  it("R3.13 the log names each shown action by position and says Your turn once the replay ends", () => {
    expect(logLines(history, 2, false)).toEqual(["UTG: Fold", "HJ: Raise 2.5bb"]);
    expect(logLines(history, 4, true)).toEqual(["UTG: Fold", "HJ: Raise 2.5bb", "CO: Fold", "BTN: Call", "Your turn"]);
    expect(logLines([], 0, true)).toEqual(["No action before you", "Your turn"]);
  });
});
