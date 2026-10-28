/**
 * The drill run screen's S26 parts (R3.13, R3.14, O-312 to O-314): the hand and decision counter,
 * the summary of the hand that just ended (closing actions, the flop in full-hand mode, why it
 * ended), the result chip a reveal that does not pause shows, the covered-part note and the note
 * a fully uncovered drill shows with the queued count read from the 422.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { fixtureFeedback } from "../../src/fixtures/index.js";
import { fixtureFullCoverage, fixturePartCoverage, fixtureStreetHands } from "../../src/fixtures/trainer.js";
import { CoverageNote, NoCoverageNote } from "../../src/routes/drill-run/CoverageNote.js";
import { HandCounter } from "../../src/routes/drill-run/HandCounter.js";
import { HandSummary } from "../../src/routes/drill-run/HandSummary.js";
import { ResultChip } from "../../src/routes/drill-run/ResultChip.js";
import type { EndedHand } from "../../src/trainer/hand-progress.js";
import { problemOf } from "../../src/trainer/spot-problem.js";

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
};

describe("R3.13 hand counter and hand summary", () => {
  it("R3.13 the counter names the hand and the decision within it", () => {
    render(<HandCounter progress={{ handNo: 2, decision: 2, stateVersion: 9, heroPosition: "BTN", endedHand: null }} />);
    expect(screen.getByTestId("hand-counter")).toHaveTextContent("Hand 3, decision 2");
  });

  it("R3.13 street mode: the summary shows how the last hand closed, with no flop", () => {
    render(<HandSummary ended={ENDED} stopRule="end_of_street" />);
    const summary = screen.getByRole("region", { name: "How hand 3 ended" });
    expect(summary).toHaveTextContent("Ended when the street closed");
    const closing = within(summary).getByRole("list", { name: "Closing actions" });
    expect(within(closing).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["BTN Raise to 22bb", "BB Call"]);
    expect(within(summary).queryByRole("group", { name: /flop/i })).not.toBeInTheDocument();
  });

  it("R3.13 full-hand mode: the summary says it ended at the flop and shows the three cards", () => {
    render(<HandSummary ended={{ ...ENDED, hand: { ...ENDED.hand, board: [...HAND.flop] } }} stopRule="end_of_hand" />);
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
    render(<HandSummary ended={{ ...ENDED, hand: { ...ENDED.hand, end: "fold" } }} stopRule="end_of_street" />);
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

describe("R3.14 covered-part note", () => {
  it("R3.14 a partly covered drill says how much it runs on and how much was queued, with a link to the library (O-312)", () => {
    render(<CoverageNote coverage={fixturePartCoverage} />);
    const note = screen.getByTestId("coverage-note");
    expect(note).toHaveTextContent("Running on 2 of 3 spots; 1 queued for the builder");
    expect(within(note).getByRole("link", { name: /library/ })).toHaveAttribute("href", "/library");
  });

  it("R3.14 a fully covered drill or a session without coverage shows no note", () => {
    const { container } = render(
      <>
        <CoverageNote coverage={fixtureFullCoverage} />
        <CoverageNote coverage={undefined} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("R3.14 a fully uncovered drill names the queued count from the 422 and links to the library", () => {
    const problem = problemOf(
      new ApiProblem({
        status: 422,
        slug: "no-coverage",
        title: "t",
        detail: "This drill cannot be dealt: the library covers none of this drill's spots. 3 of its 3 spots were queued for the builder.",
      }),
    );
    expect(problem).toEqual({ kind: "no_coverage", status: 422, queued: { queued: 3, total: 3 } });
    render(<NoCoverageNote problem={problem} />);
    const note = screen.getByTestId("no-coverage-note");
    expect(note).toHaveTextContent("3 of this drill's 3 spots were queued for the builder");
    expect(within(note).getByRole("link", { name: /library/ })).toHaveAttribute("href", "/library");
  });

  it("R3.14 a 422 whose detail names no count still links to the library, and other problems show nothing", () => {
    const problem = problemOf(new ApiProblem({ status: 422, slug: "no-coverage", title: "t", detail: "something else" }));
    expect(problem).toEqual({ kind: "no_coverage", status: 422 });
    const { rerender } = render(<NoCoverageNote problem={problem} />);
    expect(screen.getByTestId("no-coverage-note")).not.toHaveTextContent("were queued");
    expect(screen.getByRole("link", { name: /library/ })).toBeInTheDocument();
    rerender(<NoCoverageNote problem={{ kind: "network", status: null }} />);
    expect(screen.queryByTestId("no-coverage-note")).not.toBeInTheDocument();
  });
});
