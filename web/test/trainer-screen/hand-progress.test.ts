/**
 * Hand progress in street and full-hand modes (S26, R3.13, O-313, O-335, PR #30 review MEDIUM 5
 * and 6): whether a prompt continues the hand on screen or starts a new one, the hand's ordinal
 * among the hands this page has seen (never the api's hand_no, which skips when deals are
 * skipped), the decision number the prompt carries (hand_decision_no, so a reload mid-hand shows
 * the right one), and the summary of the hand that just ended, one wording per previous_hand.end.
 */
import { describe, expect, it } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixtureStreetHands } from "../../src/fixtures/trainer.js";
import { advanceHand, handCounterText, summarizeHand, type HandProgress } from "../../src/trainer/hand-progress.js";
import type { PreviousHand } from "../../src/trainer/session-types.js";

const [FIRST_HAND] = fixtureStreetHands;
if (FIRST_HAND === undefined) throw new Error("the street fixtures have no hand");

const FIRST: TrainerPrompt = { ...FIRST_HAND.first.prompt, hand_no: 0, state_version: 1, hand_decision_no: 1 };
const SECOND: TrainerPrompt = { ...FIRST_HAND.second.prompt, hand_no: 0, state_version: 2, hand_decision_no: 2 };
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
    expect(progress).toEqual({ handNo: 0, ordinal: 1, decision: 1, stateVersion: 1, heroPosition: "BTN", endedHand: null });
    expect(handCounterText(progress)).toBe("Hand 1, decision 1");
  });

  it("R3.13 a second hero decision with the same hand_no stays in one hand", () => {
    const progress = play(FIRST, SECOND);
    expect(progress).toMatchObject({ handNo: 0, ordinal: 1, decision: 2, endedHand: null });
    expect(handCounterText(progress)).toBe("Hand 1, decision 2");
  });

  it("R3.13 the same prompt read again (a stale recovery) keeps the progress", () => {
    const shown = play(FIRST, SECOND);
    expect(advanceHand(shown, SECOND)).toBe(shown);
  });

  it("R3.13 a larger hand_no starts a new hand and carries the ended hand with its hero and ordinal", () => {
    const progress = play(FIRST, SECOND, NEXT_HAND);
    expect(progress).toMatchObject({ handNo: 1, ordinal: 2, decision: 1, heroPosition: "CO", endedHand: { hand: ENDED, heroPosition: "BTN", ordinal: 1 } });
    expect(handCounterText(progress)).toBe("Hand 2, decision 1");
    const later = advanceHand(progress, { ...NEXT_HAND, state_version: 4, hand_decision_no: 2 });
    expect(later).toMatchObject({ ordinal: 2, decision: 2, endedHand: null });
  });

  it("R3.13 review MEDIUM 6: skipped hand numbers (hand_no 0 then 3) still read Hand 1 then Hand 2", () => {
    const skipped: TrainerPrompt = { ...NEXT_HAND, hand_no: 3, previous_hand: { ...ENDED, hand_no: 0 } };
    expect(handCounterText(play(FIRST))).toBe("Hand 1, decision 1");
    const progress = play(FIRST, skipped);
    expect(handCounterText(progress)).toBe("Hand 2, decision 1");
    expect(summarizeHand(progress.endedHand ?? { hand: ENDED, heroPosition: null, ordinal: null }).title).toBe("Hand 1");
  });

  it("R3.13 review MEDIUM 6 (O-335): a fresh 3-bet spot whose history holds the hero's earlier raise is decision 1", () => {
    const threeBetSpot: TrainerPrompt = { ...SECOND, hand_no: 5, hand_decision_no: 1 };
    expect(threeBetSpot.history.some((entry) => entry.position === threeBetSpot.hero_position)).toBe(true);
    expect(handCounterText(play(threeBetSpot))).toBe("Hand 1, decision 1");
  });

  it("R3.13 review MEDIUM 6 (O-335): a reload at the second decision shows decision 2 with the prompt's hero", () => {
    const reloaded: TrainerPrompt = { ...SECOND, hand_no: 7, hero_position: "BTN", hand_decision_no: 2 };
    const progress = play(reloaded);
    expect(progress).toMatchObject({ ordinal: 1, decision: 2, heroPosition: "BTN", endedHand: null });
    expect(handCounterText(progress)).toBe("Hand 1, decision 2");
  });

  it("R3.13 a previous_hand from before the first prompt seen has no known hero or ordinal", () => {
    const ended = play(NEXT_HAND).endedHand;
    expect(ended).toEqual({ hand: ENDED, heroPosition: null, ordinal: null });
    expect(summarizeHand(ended ?? { hand: ENDED, heroPosition: null, ordinal: null }).title).toBe("Previous hand");
  });
});

describe("R3.13 hand summary (review MEDIUM 5: one wording per previous_hand.end)", () => {
  it("R3.13 street mode: the summary names the hero's last action on, and the street closing", () => {
    const summary = summarizeHand({ hand: ENDED, heroPosition: "BTN", ordinal: 1 });
    expect(summary).toEqual({
      title: "Hand 1",
      endText: "Ended when the street closed",
      closing: ["BTN Raise to 22bb", "BB Call"],
      flop: [],
    });
  });

  it("R3.13 full-hand mode: the street closed at the flop, and the flop is shown", () => {
    const summary = summarizeHand({ hand: { ...ENDED, board: [...FIRST_HAND.flop] }, heroPosition: "BTN", ordinal: 1 });
    expect(summary).toMatchObject({ endText: "Ended at the flop", flop: ["Qs", "7c", "2d"] });
  });

  it.each([
    ["fold", [], "Ended with a fold"],
    ["off_range", [], "Ended when the hand left the solution's range"],
    ["stop_rule", [], "Spot over"],
    ["street_closed", [], "Ended when the street closed"],
    ["street_closed", ["Qs", "7c", "2d"], "Ended at the flop"],
  ] as const)("R3.13 end %s with board %j reads %s", (end, board, text) => {
    expect(summarizeHand({ hand: { ...ENDED, end, board: [...board] }, heroPosition: "BTN", ordinal: 1 }).endText).toBe(text);
  });

  it("R3.13 without a known hero the closing action is the hand's last action", () => {
    expect(summarizeHand({ hand: ENDED, heroPosition: null, ordinal: 1 }).closing).toEqual(["BB Call"]);
    expect(summarizeHand({ hand: { ...ENDED, history: [] }, heroPosition: "BTN", ordinal: 1 }).closing).toEqual([]);
  });
});
