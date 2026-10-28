/**
 * The paint check of POST /range-paint/submit (R3.17, O-300): a paint must name every class of the
 * prompt exactly once and only node actions; the problem counts what is wrong and never echoes a
 * class or index the caller sent.
 */
import { describe, expect, it } from "vitest";

import { ProblemError } from "../src/http/problem.js";
import { paintedHands } from "../src/range-paint/paint.js";

const HANDS = ["AA", "AKs", "72o"] as const;
const ACTIONS = [{ index: 0 }, { index: 1 }, { index: 2 }];

function problemOf(run: () => unknown): ProblemError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof ProblemError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a problem");
}

describe("R3.17 paintedHands", () => {
  it("R3.17 returns the paint in the prompt's class order", () => {
    expect(paintedHands({ hands: HANDS, actions: ACTIONS }, { "72o": 0, AA: 2, AKs: 1 })).toEqual([
      { hand: "AA", action_index: 2 },
      { hand: "AKs", action_index: 1 },
      { hand: "72o", action_index: 0 },
    ]);
  });

  it("R3.17 counts missing and extra classes in a 400 validation problem without naming them", () => {
    const problem = problemOf(() => paintedHands({ hands: HANDS, actions: ACTIONS }, { AA: 0, KAs: 1, QQ: 0 }));
    expect(problem.status).toBe(400);
    expect(problem.slug).toBe("validation");
    expect(problem.detail).toContain("2 missing");
    expect(problem.detail).toContain("2 extra");
    expect(problem.detail).not.toMatch(/KAs|QQ|AKs|72o/);
  });

  it("R3.17 counts indexes that name no node action", () => {
    const problem = problemOf(() => paintedHands({ hands: HANDS, actions: ACTIONS }, { AA: 3, AKs: 9, "72o": 0 }));
    expect(problem.status).toBe(400);
    expect(problem.detail).toContain("2 painted");
    expect(problem.detail).not.toMatch(/\b9\b/);
  });

  it("R3.17 accepts sparse action indexes exactly as the node lists them", () => {
    const sparse = [{ index: 0 }, { index: 4 }];
    expect(paintedHands({ hands: ["AA"], actions: sparse }, { AA: 4 })).toEqual([{ hand: "AA", action_index: 4 }]);
    expect(problemOf(() => paintedHands({ hands: ["AA"], actions: sparse }, { AA: 1 })).status).toBe(400);
  });
});
