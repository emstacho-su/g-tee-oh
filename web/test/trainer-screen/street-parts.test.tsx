/**
 * The drill run screen's S26 parts (R3.13, R3.14, O-312 to O-314): the hand and decision counter,
 * the summary of the hand that just ended (closing actions, the flop in full-hand mode, why it
 * ended) and the result chip a reveal that does not pause shows. The covered-part notes are in
 * coverage-notes.test.tsx.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fixtureFeedback } from "../../src/fixtures/index.js";
import { fixtureStreetHands } from "../../src/fixtures/trainer.js";
import { HandCounter } from "../../src/routes/drill-run/HandCounter.js";
import { HandSummary } from "../../src/routes/drill-run/HandSummary.js";
import { ResultChip } from "../../src/routes/drill-run/ResultChip.js";
import type { EndedHand } from "../../src/trainer/hand-progress.js";

const [HAND] = fixtureStreetHands;
if (HAND === undefined) throw new Error("the street fixtures have no hand");

const ENDED: EndedHand = {
  hand: {
    hand_no: 2,
    history: [...HAND.second.prompt.history, { position: "BTN", token: "r2200", label: "Raise to 22bb" }, HAND.closing],
    board: [],
    end: "street_closed",
  },
  heroPosition: "BTN",
  ordinal: 3,
};

describe("R3.13 hand counter and hand summary", () => {
  it("R3.13 the counter names the hand by its ordinal on this page, never the api's hand_no, and the decision", () => {
    render(<HandCounter progress={{ handNo: 7, ordinal: 3, decision: 2, stateVersion: 9, heroPosition: "BTN", endedHand: null }} />);
    expect(screen.getByTestId("hand-counter")).toHaveTextContent("Hand 3, decision 2");
  });

  it("R3.13 street mode: the summary shows how the last hand closed, with no flop", () => {
    render(<HandSummary ended={ENDED} />);
    const summary = screen.getByRole("region", { name: "How hand 3 ended" });
    expect(summary).toHaveTextContent("Ended when the street closed");
    const closing = within(summary).getByRole("list", { name: "Closing actions" });
    expect(within(closing).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["BTN Raise to 22bb", "BB Call"]);
    expect(within(summary).queryByRole("group", { name: /flop/i })).not.toBeInTheDocument();
  });

  it("R3.13 full-hand mode: the summary says it ended at the flop and shows the three cards", () => {
    render(<HandSummary ended={{ ...ENDED, hand: { ...ENDED.hand, board: [...HAND.flop] } }} />);
    const summary = screen.getByRole("region", { name: "How hand 3 ended" });
    expect(summary).toHaveTextContent("Ended at the flop");
    const flop = within(summary).getByRole("group", { name: "Hand 3 flop" });
    expect(within(flop).getAllByRole("img").map((card) => card.getAttribute("aria-label"))).toEqual([
      "Queen of spades",
      "Seven of clubs",
      "Two of diamonds",
    ]);
  });

  it("R3.13 a fold ends the hand in words", () => {
    render(<HandSummary ended={{ ...ENDED, hand: { ...ENDED.hand, end: "fold" } }} />);
    expect(screen.getByRole("region")).toHaveTextContent("Ended with a fold");
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
