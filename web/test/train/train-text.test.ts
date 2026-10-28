// /train's problem sentences (S32, R4.10, O-328): the holdout sentences come from the problem's
// slug and only on the start panel; any other problem, or the same slug in a running session,
// keeps the trainer's generic sentence.
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { problemMessage, problemOf, type SpotProblem } from "../../src/trainer/spot-problem.js";
import { trainProblemMessage } from "../../src/routes/train/train-text.js";

const COMPLETE: SpotProblem = { kind: "other", status: 409, slug: "holdout-complete" };
const NO_ITEMS: SpotProblem = { kind: "other", status: 422, slug: "no-holdout-items" };
const VALIDATION: SpotProblem = { kind: "other", status: 422, slug: "validation" };
const MISMATCH: SpotProblem = { kind: "other", status: 422, slug: "idempotency-mismatch" };

describe("R4.10 trainProblemMessage", () => {
  it("R4.10 problemOf keeps the api problem's slug", () => {
    expect(problemOf(new ApiProblem({ status: 409, slug: "holdout-complete", title: "t" }))).toEqual(COMPLETE);
  });

  it("R4.10 a holdout start names a complete round and a round with no items by slug", () => {
    expect(trainProblemMessage("holdout", COMPLETE, true)).toMatch(/^This month's retest is complete\./);
    expect(trainProblemMessage("holdout", NO_ITEMS, true)).toMatch(/^No retest spots are drawn/);
  });

  it("R4.10 a 422 validation or an idempotency refusal on start gets the generic sentence", () => {
    expect(trainProblemMessage("holdout", VALIDATION, true)).toBe(problemMessage(VALIDATION));
    expect(trainProblemMessage("holdout", MISMATCH, true)).toBe(problemMessage(MISMATCH));
  });

  it("R4.10 a running retest never gets a start sentence, whatever the slug", () => {
    expect(trainProblemMessage("holdout", COMPLETE, false)).toBe(problemMessage(COMPLETE));
    expect(trainProblemMessage("holdout", NO_ITEMS, false)).toBe(problemMessage(NO_ITEMS));
  });

  it("R4.10 an automated session never gets a holdout sentence", () => {
    expect(trainProblemMessage("automated", COMPLETE, true)).toBe(problemMessage(COMPLETE));
  });
});
