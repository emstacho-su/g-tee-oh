/**
 * Pure parts of the S26 review fixes on the drill screens (R3.14, PR #30 review MEDIUM 1, MEDIUM 2,
 * LOW 12): the client flop pattern refuses a flop that repeats a card, the field error cap and its
 * errors_omitted count, and the sentence for a refused export.
 */
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { exportFailureText, FAILURE_TEXT, isExportRefused } from "../../src/drills/failure-text.js";
import { FLOP_PATTERN } from "../../src/drills/limits.js";
import { cappedFieldErrorsOf, drillProblemFromBody, MAX_LISTED_FIELD_ERRORS, omittedErrorsOfFailure } from "../../src/drills/problem.js";
import { fieldErrorLine, moreErrorsText } from "../../src/routes/drills/ErrorList.js";

describe("R3.14 review LOW 12: the client flop pattern", () => {
  it.each(["Kh8d3c", "AsKsQs", "2c2d2h"])("R3.14 %s is a flop", (flop) => {
    expect(FLOP_PATTERN.test(flop)).toBe(true);
  });

  it.each(["KhKh3c", "Kh8dKh", "Kh8d8d", "AsAsAs", "Kh8d", "Kh8d3c2s", "kh8d3c", "1h2d3c"])("R3.14 %s is refused", (flop) => {
    expect(FLOP_PATTERN.test(flop)).toBe(false);
  });
});

describe("R3.14 review MEDIUM 1: the field error cap", () => {
  it("R3.14 keeps the first 20, drops entries that are not errors, and counts the rest with errors_omitted", () => {
    const errors = [{ path: 3 }, ...Array.from({ length: 30 }, (_, index) => ({ path: `body.tags.${index}`, message: "bad" }))];
    const capped = cappedFieldErrorsOf({ errors, errors_omitted: 5 });
    expect(capped.listed).toHaveLength(MAX_LISTED_FIELD_ERRORS - 1);
    expect(capped.omitted).toBe(errors.length - MAX_LISTED_FIELD_ERRORS + 5);
  });

  it.each([null, "x", { errors: "no" }, { errors_omitted: -2 }, { errors_omitted: Number.MAX_VALUE }])("R3.14 %j gives no errors and no count", (body) => {
    expect(cappedFieldErrorsOf(body)).toEqual({ listed: [], omitted: 0 });
  });

  it("R3.14 the omitted count is read only from a DrillProblem", () => {
    expect(omittedErrorsOfFailure(drillProblemFromBody(400, { errors: [], errors_omitted: 7 }))).toBe(7);
    expect(omittedErrorsOfFailure(new ApiProblem({ status: 400, slug: "validation", title: "t" }))).toBe(0);
  });

  it("R3.14 an error line drops the body. or drill. location; the more line names the count", () => {
    expect(fieldErrorLine({ path: "body.spot_filter.stake", message: "m" })).toBe("spot_filter.stake: m");
    expect(fieldErrorLine({ path: "drill.spot_filter.stake", message: "m" })).toBe("spot_filter.stake: m");
    expect(fieldErrorLine({ path: "drill", message: "m" })).toBe("m");
    expect(fieldErrorLine({ path: "spot_filter.stake", message: "m" })).toBe("spot_filter.stake: m");
    expect(fieldErrorLine({ path: "body.", message: "m" })).toBe("m");
    expect(moreErrorsText(12)).toBe("and 12 more");
  });
});

describe("R3.14 review MEDIUM 2: a refused export", () => {
  const refused = new ApiProblem({ status: 422, slug: "validation", title: "t", detail: "This drill can no longer be exported: x." });

  it("R3.14 a 422 validation is a refused export and shows the api's detail", () => {
    expect(isExportRefused(refused)).toBe(true);
    expect(exportFailureText(refused)).toBe("This drill can no longer be exported: x.");
  });

  it("R3.14 a refused export without a detail gets the fixed sentence; other failures keep theirs", () => {
    const bare = new ApiProblem({ status: 422, slug: "validation", title: "t" });
    expect(exportFailureText(bare)).toBe(FAILURE_TEXT.exportRefused);
    expect(isExportRefused(new ApiProblem({ status: 422, slug: "no-coverage", title: "t" }))).toBe(false);
    expect(exportFailureText(new ApiProblem({ status: 404, slug: "not-found", title: "t" }))).toBe(FAILURE_TEXT.notFound);
    expect(exportFailureText(new Error("x"))).toBe(FAILURE_TEXT.generic);
  });
});
