/**
 * Tests for the action filters' pure rules (S45, R3.12, O-468): the `filters` address parameter
 * (a comma list of NodeAction.index values, validated and de-duplicated), the search updates that
 * set and clear it, and the click rule: a row toggles its index; a second row clicked while
 * exactly one is selected opens Compare to Best on that row with both kept.
 */
import { describe, expect, it } from "vitest";

import { nextFilterState, parseFilters, withFilters } from "../../src/study/action-filters.js";
import { validateStudySearch } from "../../src/study/search.js";

describe("R3.12 the filters parameter", () => {
  it("R3.12 keeps a comma list of small distinct integers and drops anything else", () => {
    expect(validateStudySearch({ filters: "2" })).toEqual({ filters: "2" });
    expect(validateStudySearch({ filters: "0,2,13" })).toEqual({ filters: "0,2,13" });
    expect(validateStudySearch({ filters: "2,2" })).toEqual({});
    expect(validateStudySearch({ filters: "a,2" })).toEqual({});
    expect(validateStudySearch({ filters: "256" })).toEqual({});
    expect(validateStudySearch({ filters: "" })).toEqual({});
    expect(validateStudySearch({ filters: "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17" })).toEqual({});
  });

  it("R3.12 parseFilters reads the indexes in address order and an absent parameter as none", () => {
    expect(parseFilters({ filters: "2,0" })).toEqual([2, 0]);
    expect(parseFilters({})).toEqual([]);
  });

  it("R3.12 withFilters writes the sorted set and removes the parameter when the set is empty", () => {
    expect(withFilters({ pair: "BB-BTN", line: "r250" }, [2, 0])).toEqual({ pair: "BB-BTN", line: "r250", filters: "0,2" });
    expect(withFilters({ pair: "BB-BTN", filters: "0,2" }, [])).toEqual({ pair: "BB-BTN" });
  });
});

describe("R3.12 the click rule (O-468)", () => {
  it("R3.12 a click toggles the row's index", () => {
    expect(nextFilterState([], 2)).toEqual({ filters: [2], compare: null });
    expect(nextFilterState([2], 2)).toEqual({ filters: [], compare: null });
    expect(nextFilterState([0, 2], 2)).toEqual({ filters: [0], compare: null });
  });

  it("R3.12 a second row clicked while exactly one is selected opens Compare on that row and keeps both", () => {
    expect(nextFilterState([2], 1)).toEqual({ filters: [1, 2], compare: 1 });
  });

  it("R3.12 with two or more selected a further click only adds", () => {
    expect(nextFilterState([1, 2], 0)).toEqual({ filters: [0, 1, 2], compare: null });
  });
});
