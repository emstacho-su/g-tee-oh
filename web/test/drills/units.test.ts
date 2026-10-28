/**
 * The drill screens' small pure parts (S26, R3.14): the spot summary line, the route search
 * validators, the failure sentences and the problem parsing that keeps the api's field errors.
 */
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { drillFailureText, FAILURE_TEXT, importFailureText } from "../../src/drills/failure-text.js";
import { drillProblemFromBody, fieldErrorsOfFailure, isDrillInUse } from "../../src/drills/problem.js";
import { validateDrillBuilderSearch, validateDrillsSearch } from "../../src/drills/search.js";
import { spotSummary } from "../../src/drills/summary.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";

describe("R3.14 drill screen units", () => {
  it("R3.14 the spot summary names the game, seats, actions and hands in words", () => {
    expect(spotSummary(fixtureDrill.spot_filter)).toBe("Online 6-handed, 100 bb, stake online; hero BTN against BB; RFI; all hands");
    const manual = { ...fixtureDrill.spot_filter, start_street: "flop" as const, villain_positions: [], hands: { mode: "manual" as const, hands: ["AKs"] } };
    expect(spotSummary(manual)).toBe("Online 6-handed, 100 bb, stake online; hero BTN against any opponent; RFI, from the flop; 1 chosen hand");
    expect(spotSummary({ ...manual, hands: { mode: "manual", hands: ["AKs", "77"] } })).toMatch(/2 chosen hands$/);
  });

  it("R3.14 the search validators keep a valid tag and saved=1 only", () => {
    expect(validateDrillsSearch({ tag: "rfi" })).toEqual({ tag: "rfi" });
    expect(validateDrillsSearch({ tag: "RFI" })).toEqual({});
    expect(validateDrillsSearch({ tag: 3 })).toEqual({});
    expect(validateDrillBuilderSearch({ saved: "1" })).toEqual({ saved: "1" });
    expect(validateDrillBuilderSearch({ saved: "yes" })).toEqual({});
  });

  it("R3.14 failure sentences follow the status; an import 400 shows the api's detail", () => {
    const problem = (status: number, detail?: string) =>
      new ApiProblem({ status, slug: "x", title: "t", ...(detail === undefined ? {} : { detail }) });
    expect(drillFailureText(problem(409))).toBe(FAILURE_TEXT.inUse);
    expect(drillFailureText(problem(404))).toBe(FAILURE_TEXT.notFound);
    expect(drillFailureText(problem(400))).toBe(FAILURE_TEXT.invalid);
    expect(drillFailureText(problem(500))).toBe(FAILURE_TEXT.generic);
    expect(drillFailureText(new Error("network"))).toBe(FAILURE_TEXT.generic);
    expect(importFailureText(problem(400, "The export code is damaged."))).toBe("The export code is damaged.");
    expect(importFailureText(problem(400))).toBe(FAILURE_TEXT.importRefused);
    expect(importFailureText(problem(429))).toBe(FAILURE_TEXT.rateLimited);
    expect(isDrillInUse(problem(409))).toBe(true);
    expect(isDrillInUse(problem(404))).toBe(false);
  });

  it("R3.14 a problem body's field errors are kept, and malformed entries dropped", () => {
    const body = {
      type: "urn:g-tee-oh:problem:validation",
      title: "Request validation failed",
      status: 400,
      detail: "bad",
      errors: [{ path: "body.name", message: "too long" }, { path: 3, message: "x" }, "nope"],
    };
    const problem = drillProblemFromBody(400, body);
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem).toMatchObject({ status: 400, slug: "validation", detail: "bad" });
    expect(fieldErrorsOfFailure(problem)).toEqual([{ path: "body.name", message: "too long" }]);
    expect(fieldErrorsOfFailure(new Error("x"))).toEqual([]);
    expect(drillProblemFromBody(500, null).fieldErrors).toEqual([]);
    expect(drillProblemFromBody(400, { type: "urn:g-tee-oh:problem:validation", title: "t", errors: "no" }).fieldErrors).toEqual([]);
  });
});
