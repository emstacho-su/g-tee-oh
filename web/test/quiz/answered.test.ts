/**
 * The quiz run's pure parts (S41, R3.16, O-410, O-412, O-414): the answered list for Previous
 * (newest last, capped at 50, never mutated), the review steps, the reason rule (3 to 1,000
 * characters after trimming) and the passed text by difficulty. Nothing names a rating or score.
 */
import { describe, expect, it } from "vitest";

import { fixturePredictionResult, fixturePredictions } from "../../src/fixtures/prediction.js";
import { MAX_ANSWERED, appendAnswered, reviewStep, type AnsweredItem } from "../../src/prediction/answered.js";
import { REASON_MAX_CHARS, REASON_MIN_CHARS, reasonCount, reasonReady } from "../../src/prediction/draft.js";
import { passedText, problemText, windowText } from "../../src/prediction/labels.js";
import { ApiProblem } from "../../src/api/index.js";

function item(order: number): AnsweredItem {
  const entry = fixturePredictions[order % fixturePredictions.length];
  if (entry === undefined) throw new Error("no fixture");
  return {
    prompt: { ...entry.prompt, prompt_id: `p-${order}` },
    draft: { kind: "yes_no", value: true },
    reason: `reason ${order}`,
    result: fixturePredictionResult(entry, { kind: "yes_no", value: true }, order),
  };
}

describe("R3.16 the answered list behind Previous (O-414)", () => {
  it("R3.16 appends newest last and returns a new list", () => {
    const first = appendAnswered([], item(0));
    const second = appendAnswered(first, item(1));
    expect(first).toHaveLength(1);
    expect(second.map((entry) => entry.reason)).toEqual(["reason 0", "reason 1"]);
  });

  it("R3.16 keeps at most 50, dropping the oldest", () => {
    const full = Array.from({ length: MAX_ANSWERED + 3 }, (_, index) => index).reduce<readonly AnsweredItem[]>((list, index) => appendAnswered(list, item(index)), []);
    expect(MAX_ANSWERED).toBe(50);
    expect(full).toHaveLength(MAX_ANSWERED);
    expect(full[0]?.reason).toBe("reason 3");
    expect(full.at(-1)?.reason).toBe(`reason ${MAX_ANSWERED + 2}`);
  });

  it("R3.16 review steps stop at the oldest and the newest", () => {
    expect(reviewStep(3, 5, -1)).toBe(2);
    expect(reviewStep(0, 5, -1)).toBe(0);
    expect(reviewStep(4, 5, 1)).toBe(4);
    expect(reviewStep(2, 5, 1)).toBe(3);
  });
});

describe("R3.16 the reason rule (O-412)", () => {
  it("R3.16 a reason is ready from 3 characters after trimming, up to 1,000", () => {
    expect(REASON_MIN_CHARS).toBe(3);
    expect(REASON_MAX_CHARS).toBe(1000);
    expect(reasonReady("  ab  ")).toBe(false);
    expect(reasonReady(" abc ")).toBe(true);
    expect(reasonReady("x".repeat(1001))).toBe(false);
    expect(reasonCount("abc")).toBe("3 / 1000");
  });
});

describe("R3.16 quiz result text (O-410)", () => {
  it("R3.16 names the passed difficulty by level", () => {
    expect(passedText(1)).toBe("Passed Easy at this spot");
    expect(passedText(2)).toBe("Passed Medium at this spot");
    expect(passedText(3)).toBe("Passed Hard at this spot");
  });

  it("R3.16 the window line of a quiz says what passes, never what unlocks", () => {
    const window = { answers: 20, correct: 18, size: 20, required_pct: 90 };
    expect(windowText(window, "quiz")).toBe("Last 20 at this level: 18 correct of 20 (90 percent passes this level)");
    expect(windowText(window, "drill")).toContain("unlocks the next level");
  });

  it("R3.16 a no-coverage start shows the fixed sentence, never the server's detail", () => {
    const problem = new ApiProblem({ status: 422, slug: "no-coverage", title: "t", detail: "server detail text" });
    expect(problemText(problem)).toBe("The library has no solved spot for these choices yet. They were queued for the builder.");
  });
});
