/**
 * The trainer's key map by action kind (S46, R3.30, design rule 9, O-475): one fixed letter per
 * kind for fold, call, check, all-in and limp, digits for the bet and raise sizes in bar order, and
 * no key that moves with the number of buttons.
 */
import { describe, expect, it } from "vitest";

import { KIND_KEYS, SIZE_KINDS, actionHotkeys } from "../../src/components/trainer/action-keys.js";
import type { NodeAction } from "../../src/contracts.js";
import { fixtureActions } from "../../src/fixtures/index.js";
import { END_SESSION_KEY, NEXT_HAND_KEY } from "../../src/routes/drill-run/labels.js";
import { RNG_EXPLAINER_KEY } from "../../src/components/trainer/use-rng-explainer.js";
import { REPEAT_HAND_KEY, SHORTCUTS_KEY } from "../../src/hotkeys/index.js";

function action(index: number, kind: NodeAction["kind"], size: number | null = null): NodeAction {
  return { index, token: `${kind}${index}`, kind, size_cbb: size, bucket: null, label: `${kind} ${index}`, next_node_key: null };
}

describe("R3.30 action keys by kind", () => {
  it("R3.30 fold is F, call is C, check is X, all-in is A, limp is L; bet, raise and straddle have no letter", () => {
    expect(KIND_KEYS).toEqual({ fold: "f", call: "c", check: "x", all_in: "a", limp: "l" });
    expect(SIZE_KINDS).toEqual(["bet", "raise"]);
  });

  it("R3.30 no letter collides with the session, explainer, overlay, study or reserved keys", () => {
    // S stays free for Study this spot, which the follow-up adds (PR #45 review round 1, finding 3).
    const taken = new Set([NEXT_HAND_KEY, END_SESSION_KEY, REPEAT_HAND_KEY, "S", RNG_EXPLAINER_KEY, SHORTCUTS_KEY].map((key) => key.toLowerCase()));
    for (const letter of Object.values(KIND_KEYS)) expect(taken.has(letter)).toBe(false);
  });

  it("R3.30 the fixture bar (fold, call, raise, all-in) reads F, C, 1, A", () => {
    expect(actionHotkeys(fixtureActions)).toEqual(["f", "c", "1", "a"]);
  });

  it("R3.30 digits number only the bet and raise buttons, in bar order, whatever stands before them", () => {
    const flop = [action(0, "check"), action(1, "bet", 330), action(2, "bet", 1000), action(3, "all_in", 10000)];
    expect(actionHotkeys(flop)).toEqual(["x", "1", "2", "a"]);
    const facing = [action(0, "fold"), action(1, "call"), action(2, "raise", 900), action(3, "raise", 2200)];
    expect(actionHotkeys(facing)).toEqual(["f", "c", "1", "2"]);
    // The same raise sizes keep 1 and 2 when the fold and call are absent (O-475).
    expect(actionHotkeys([action(2, "raise", 900), action(3, "raise", 2200)])).toEqual(["1", "2"]);
  });

  it("R3.30 only the first nine sizes get a digit; a limp gets L and a straddle nothing", () => {
    const many = Array.from({ length: 10 }, (_, index) => action(index, "bet", (index + 1) * 100));
    const keys = actionHotkeys([action(20, "limp"), action(21, "straddle"), ...many]);
    expect(keys.slice(0, 2)).toEqual(["l", null]);
    expect(keys.slice(2)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", null]);
  });

  it("R3.30 returns a new array and never mutates the actions", () => {
    const actions = [...fixtureActions];
    const before = JSON.stringify(actions);
    actionHotkeys(actions);
    expect(JSON.stringify(actions)).toBe(before);
  });
});
