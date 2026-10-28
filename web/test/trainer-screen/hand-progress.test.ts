/**
 * Hand progress in street and full-hand modes (S26, R3.13, O-313): whether a prompt continues the
 * hand on screen or starts a new one, the decision number within the hand, and the summary of the
 * hand that just ended, worded for the drill's stop rule.
 */
import { describe, expect, it } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixtureStreetHands } from "../../src/fixtures/trainer.js";
import { advanceHand, handCounterText, summarizeHand, type HandProgress } from "../../src/trainer/hand-progress.js";
import type { PreviousHand } from "../../src/trainer/session-types.js";

const [FIRST_HAND] = fixtureStreetHands;
if (FIRST_HAND === undefined) throw new Error("the street fixtures have no hand");

const FIRST: TrainerPrompt = { ...FIRST_HAND.first.prompt, hand_no: 0, state_version: 1 };
const SECOND: TrainerPrompt = { ...FIRST_HAND.second.prompt, hand_no: 0, state_version: 2 };
const ENDED: PreviousHand = {
  hand_no: 0,
  history: [...SECOND.history, { position: "BTN", token: "r2200", label: "Raise to 22bb" }, FIRST_HAND.closing],
  board: [],
  end: "street_closed",
};
const NEXT_HAND: TrainerPrompt = { ...FIRST, hand_no: 1, state_version: 3, previous_hand: ENDED, hero_position: "CO" };

function play(...prompts: readonly TrainerPrompt[]): HandProgress {
  const progress = prompts.reduce<HandProgress | null>((previous, prompt) => advanceHand(previous, prompt), null);
  if (progress === null) throw new Error("no prompt played");
  return progress;
}

describe("R3.13 hand progress", () => {
  it("R3.13 the first prompt starts hand 1 at decision 1 with nothing ended", () => {
    const progress = play(FIRST);
    expect(progress).toEqual({ handNo: 0, decision: 1, stateVersion: 1, heroPosition: "BTN", endedHand: null });
    expect(handCounterText(progress)).toBe("Hand 1, decision 1");
  });

  it("R3.13 a second hero decision with the same hand_no stays in one hand", () => {
    const progress = play(FIRST, SECOND);
    expect(progress).toMatchObject({ handNo: 0, decision: 2, endedHand: null });
    expect(handCounterText(progress)).toBe("Hand 1, decision 2");
  });

  it("R3.13 the same prompt read again (a stale recovery) keeps the decision number", () => {
    const shown = play(FIRST, SECOND);
    expect(advanceHand(shown, SECOND)).toBe(shown);
  });

  it("R3.13 a larger hand_no starts a new hand and carries the ended hand with its hero", () => {
    const progress = play(FIRST, SECOND, NEXT_HAND);
    expect(progress).toMatchObject({ handNo: 1, decision: 1, heroPosition: "CO", endedHand: { hand: ENDED, heroPosition: "BTN" } });
    expect(handCounterText(progress)).toBe("Hand 2, decision 1");
    const later = advanceHand(progress, { ...NEXT_HAND, state_version: 4 });
    expect(later).toMatchObject({ decision: 2, endedHand: null });
  });

  it("R3.13 a previous_hand from before the first prompt seen has no known hero", () => {
    expect(play(NEXT_HAND).endedHand).toEqual({ hand: ENDED, heroPosition: null });
  });

  it("R3.13 street mode: the summary names the hero's last action on, and the street closing", () => {
    const summary = summarizeHand({ hand: ENDED, heroPosition: "BTN" }, "end_of_street");
    expect(summary).toEqual({
      title: "Hand 1",
      endText: "Ended when the street closed",
      closing: ["BTN Raise to 22bb", "BB Call"],
      flop: [],
    });
  });

  it("R3.13 full-hand mode: the hand ended at the flop, and the flop is shown", () => {
    const summary = summarizeHand({ hand: { ...ENDED, board: [...FIRST_HAND.flop] }, heroPosition: "BTN" }, "end_of_hand");
    expect(summary).toMatchObject({ endText: "Ended at the flop", flop: ["Qs", "7c", "2d"] });
  });

  it.each([
    ["fold", "end_of_street", "Ended with a fold"],
    ["off_range", "end_of_hand", "Ended when the hand left the solution's range"],
    ["stop_rule", "after_action", "Ended after your decision"],
    ["stop_rule", "end_of_street", "Ended at the end of the street"],
    ["stop_rule", "end_of_hand", "Ended at the end of the hand"],
    ["street_closed", "end_of_hand", "Ended when the street closed"],
  ] as const)("R3.13 end %s in %s reads %s", (end, stopRule, text) => {
    expect(summarizeHand({ hand: { ...ENDED, end }, heroPosition: "BTN" }, stopRule).endText).toBe(text);
  });

  it("R3.13 without a known hero the closing action is the hand's last action", () => {
    expect(summarizeHand({ hand: ENDED, heroPosition: null }, "end_of_street").closing).toEqual(["BB Call"]);
    expect(summarizeHand({ hand: { ...ENDED, history: [] }, heroPosition: "BTN" }, "end_of_street").closing).toEqual([]);
  });
});
