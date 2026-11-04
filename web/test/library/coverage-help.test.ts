/**
 * The coverage tables' one-line definitions (S47 critic G8; S48 round 5 verifier on the five
 * library screens, R3.4): product copy says what a scenario is in words and cites no internal
 * document number.
 */
import { describe, expect, it } from "vitest";

import { COLUMN_HELP } from "../../src/components/library/CoverageDetail.js";

describe("R3.4 the coverage column help", () => {
  it("R3.4 defines scenarios and priority in words, with no ADR citation in user copy", () => {
    expect(COLUMN_HELP.scenarios).toMatch(/^Scenarios: the pre-dealt turn and river runouts solved for the flop\.$/);
    for (const text of Object.values(COLUMN_HELP)) expect(text).not.toMatch(/ADR \d/);
  });
});
