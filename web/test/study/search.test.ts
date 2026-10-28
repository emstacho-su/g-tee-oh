// Tests for the /study search parameters (S25, R3.12, O-286): validation keeps only the shapes the
// api accepts and the screen's defaults fill what the URL leaves out.
import { describe, expect, it } from "vitest";

import { DEFAULT_STUDY_MODE, studyModeOf, validateStudySearch } from "../../src/study/search.js";

describe("R3.12 study search parameters", () => {
  it("R3.12 keeps every valid parameter and parses numbers from the URL strings", () => {
    const search = validateStudySearch({
      format: "online",
      table_size: "6",
      stake: "00000000-0000-4000-8000-0000000000a1",
      depth: "10000",
      pair: "BB-BTN",
      line: "r250.r1100",
      mode: "ev",
      hand: "AKs",
    });
    expect(search).toEqual({
      format: "online",
      table_size: 6,
      stake: "00000000-0000-4000-8000-0000000000a1",
      depth: 10000,
      pair: "BB-BTN",
      line: "r250.r1100",
      mode: "ev",
      hand: "AKs",
    });
  });

  it("R3.12 drops malformed values instead of passing them to the api", () => {
    const search = validateStudySearch({
      format: "home game",
      table_size: 12,
      stake: "a b",
      depth: -5,
      pair: "BB-XX",
      line: "R250..",
      mode: "heat",
      hand: "AKx",
    });
    expect(search).toEqual({});
  });

  it("R3.12 the matrix mode defaults to frequency when the URL has none", () => {
    expect(DEFAULT_STUDY_MODE).toBe("frequency");
    expect(studyModeOf({})).toBe("frequency");
    expect(studyModeOf({ mode: "weight" })).toBe("weight");
  });
});
