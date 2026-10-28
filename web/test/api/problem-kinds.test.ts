// The shared problem kinds (S25, R3.12, R3.13): one hand-not-in-range test for the study screen
// and the trainer's feedback panel.
import { describe, expect, it } from "vitest";

import { ApiProblem, HAND_NOT_IN_RANGE_SLUG, isHandNotInRange } from "../../src/api/index.js";

describe("R3.12 problem kinds", () => {
  it("R3.12 a 404 hand-not-in-range problem is recognised", () => {
    expect(isHandNotInRange(new ApiProblem({ status: 404, slug: HAND_NOT_IN_RANGE_SLUG, title: "t" }))).toBe(true);
  });

  it("R3.12 another 404, the same slug at another status, and non-problems are not", () => {
    expect(isHandNotInRange(new ApiProblem({ status: 404, slug: "not-found", title: "t" }))).toBe(false);
    expect(isHandNotInRange(new ApiProblem({ status: 400, slug: HAND_NOT_IN_RANGE_SLUG, title: "t" }))).toBe(false);
    expect(isHandNotInRange(new Error("x"))).toBe(false);
    expect(isHandNotInRange(undefined)).toBe(false);
  });
});
