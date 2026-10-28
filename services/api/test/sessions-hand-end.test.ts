/**
 * handEndAt (R3.13, O-313, PR #30 review MEDIUM 5): previous_hand.end is named on the edge into
 * hand_end from the phase the machine leaves, never guessed from the board.
 */
import { describe, expect, it } from "vitest";

import { ProblemError } from "../src/http/problem.js";
import { handEndAt } from "../src/sessions/hand-end.js";

describe("R3.13 handEndAt names how a hand ended", () => {
  it("R3.13 a fold or off-range hand keeps its own end under every stop rule", () => {
    expect(handEndAt("feedback", "after_action", { end: "fold" })).toBe("fold");
    expect(handEndAt("street_end", "end_of_street", { end: "fold" })).toBe("fold");
    expect(handEndAt("feedback", "end_of_hand", { end: "off_range" })).toBe("off_range");
  });

  it("R3.13 after_action ends from feedback as the stop rule, even when the street closed", () => {
    expect(handEndAt("feedback", "after_action", { end: null })).toBe("stop_rule");
    expect(handEndAt("feedback", "after_action", { end: "street_closed" })).toBe("stop_rule");
  });

  it("R3.13 the street closing and the flop reveal end as street_closed", () => {
    expect(handEndAt("street_end", "end_of_street", { end: "street_closed" })).toBe("street_closed");
    expect(handEndAt("reveal", "end_of_hand", { end: null })).toBe("street_closed");
  });

  it("R3.13 an edge that never reaches hand_end is a 500, not a guess", () => {
    expect(() => handEndAt("dealing", "end_of_hand", { end: null })).toThrow(ProblemError);
    expect(() => handEndAt("feedback", "end_of_street", { end: null })).toThrow(ProblemError);
  });
});
