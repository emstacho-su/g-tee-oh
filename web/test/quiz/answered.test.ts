/**
 * The quiz run's pure parts (S41, R3.16, O-410, O-412, O-414): the answered list for Previous
 * (newest last, capped at 50, never mutated), the review steps, the reason rule (the shared
 * rationaleReady from @g-tee-oh/contracts) and its raw count, the passed text by difficulty and the
 * no-quiz-questions sentence. Nothing names a rating or score.
 */
import { RATIONALE_MAX_CHARS, RATIONALE_MIN_CHARS, rationaleReady } from "@g-tee-oh/contracts";
import { describe, expect, it } from "vitest";

import { fixturePredictionResult, fixturePredictions } from "../../src/fixtures/prediction.js";
import { MAX_ANSWERED, appendAnswered, reviewStep, type AnsweredItem } from "../../src/prediction/answered.js";
import { reasonCount } from "../../src/prediction/draft.js";
import { passedText, problemText, windowText } from "../../src/prediction/labels.js";
import { noQuestionsText, quizDifficultyName } from "../../src/prediction/quiz-text.js";
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

describe("R3.16 the reason rule (O-412, PR #39 review finding 3)", () => {
  it("R3.16 the web reads the shared rule: 3 visible characters, up to 1,000; the count is the raw length", () => {
    expect(RATIONALE_MIN_CHARS).toBe(3);
    expect(RATIONALE_MAX_CHARS).toBe(1000);
    expect(rationaleReady("  ab  ")).toBe(false);
    expect(rationaleReady(" abc ")).toBe(true);
    expect(rationaleReady("x".repeat(1001))).toBe(false);
    expect(reasonCount("abc")).toBe("3 / 1000");
    expect(reasonCount("ㅤㅤㅤ")).toBe("3 / 1000");
  });
});

describe("R3.16 no-quiz-questions text (O-411 amended)", () => {
  it("R3.16 names the difficulty, and the kind only when exactly one was chosen", () => {
    expect(noQuestionsText("hard", ["hand"])).toBe("No more Hard hand questions in these spots; try more spot types or another difficulty.");
    expect(noQuestionsText("medium", ["range"])).toBe("No more Medium range questions in these spots; try more spot types or another difficulty.");
    expect(noQuestionsText("easy", ["range", "hand"])).toBe("No more Easy questions in these spots; try more spot types or another difficulty.");
    expect(quizDifficultyName("hard")).toBe("Hard");
  });

  it("R3.16 problemText has a fixed sentence for the slug too, never the server's detail", () => {
    const problem = new ApiProblem({ status: 422, slug: "no-quiz-questions", title: "t", detail: "server detail text" });
    expect(problemText(problem)).toBe("No more questions in these spots; try more spot types or another difficulty.");
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
