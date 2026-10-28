/**
 * The drill run screen's S26 parts (R3.13, R3.14, O-312 to O-314): the hand and decision counter
 * and the result chip a reveal that does not pause shows. The summary of the hand that just ended
 * is gone (S40, O-352); the api logs it instead. The covered-part notes are in
 * coverage-notes.test.tsx.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fixtureFeedback } from "../../src/fixtures/index.js";
import { HandCounter } from "../../src/routes/drill-run/HandCounter.js";
import { ResultChip } from "../../src/routes/drill-run/ResultChip.js";

describe("R3.13 hand counter", () => {
  it("R3.13 the counter names the hand by its ordinal on this page, never the api's hand_no, and the decision", () => {
    render(<HandCounter progress={{ handNo: 7, ordinal: 3, decision: 2, stateVersion: 9, heroPosition: "BTN" }} />);
    expect(screen.getByTestId("hand-counter")).toHaveTextContent("Hand 3, decision 2");
  });

});

describe("R3.13 result chip", () => {
  it("R3.13 a reveal that does not pause shows the label in words with its symbol and the EV loss (O-314)", () => {
    render(<ResultChip feedback={{ ...fixtureFeedback, label: "best", ev_loss_bb: 0 }} />);
    const chip = screen.getByTestId("result-chip");
    expect(chip).toHaveTextContent("Best");
    expect(chip).toHaveTextContent("EV loss 0.00bb");
    expect(chip).toHaveAttribute("role", "status");
  });

  it("R3.13 an inaccuracy shows its own label", () => {
    render(<ResultChip feedback={fixtureFeedback} />);
    expect(screen.getByTestId("result-chip")).toHaveTextContent("Inaccuracy");
  });
});
