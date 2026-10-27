/** Tests for the FeedbackPanel shell shown after a decision (S24, R3.13). */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FeedbackPanel } from "../../src/components/trainer/index.js";
import type { DecisionFeedback, NodeAction } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";

/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));
/** The fixture feedback with its best action (Raise, index 2) renumbered to match OFFSET_ACTIONS. */
const OFFSET_FEEDBACK: DecisionFeedback = { ...fixtureFeedback, best_action_indexes: [12] };

describe("R3.13 FeedbackPanel", () => {
  it("R3.13 shows the label as text with a symbol, not color alone", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} />);
    const label = screen.getByTestId("feedback-label");
    expect(label).toHaveTextContent("Inaccuracy");
    expect(label).toHaveAttribute("data-label", "inaccuracy");
    expect(within(label).getByText("?!")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["best", "Best"],
    ["correct", "Correct"],
    ["mistake", "Mistake"],
    ["blunder", "Blunder"],
  ] as const)("R3.13 names the %s label", (value, text) => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, label: value };
    render(<FeedbackPanel feedback={feedback} actions={fixtureActions} chosenIndex={2} />);
    expect(screen.getByTestId("feedback-label")).toHaveTextContent(text);
  });

  it("R3.13 shows EV loss in bb and percent pot, the chosen action and the roll", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} />);
    const panel = screen.getByTestId("feedback-panel");
    expect(panel).toHaveTextContent("EV loss 0.01bb (0.73% of pot)");
    expect(panel).toHaveTextContent("Your action: Call");
    expect(panel).toHaveTextContent("Roll 37");
    expect(panel).not.toHaveTextContent("Unrated");
  });

  it("R3.13 lists the hand's frequency per action with the best actions marked Best", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} />);
    const table = screen.getByRole("table", { name: "This hand's strategy" });
    const raiseRow = within(table).getByRole("row", { name: /Raise 2.5bb/ });
    expect(raiseRow).toHaveTextContent("80.0%");
    expect(raiseRow).toHaveTextContent("Best");
    expect(within(table).getByRole("row", { name: /Fold/ })).not.toHaveTextContent("Best");
  });

  it("R3.13 says Unrated and hides the roll when there is none", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, rated: false, rng_roll: null };
    render(<FeedbackPanel feedback={feedback} actions={fixtureActions} chosenIndex={0} />);
    const panel = screen.getByTestId("feedback-panel");
    expect(panel).toHaveTextContent("Unrated");
    expect(panel).not.toHaveTextContent("Roll");
  });

  it("R3.13 More info and Ask are disabled with an S27 note when their handlers are absent", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} />);
    const more = screen.getByRole("button", { name: "More info" });
    const ask = screen.getByRole("button", { name: "Ask" });
    expect(more).toBeDisabled();
    expect(ask).toBeDisabled();
    expect(more).toHaveAttribute("title", expect.stringContaining("S27"));
    expect(ask).toHaveAttribute("title", expect.stringContaining("S27"));
  });

  it("R3.13 More info and Ask call their handlers when given", async () => {
    const onMoreInfo = vi.fn();
    const onAsk = vi.fn();
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        onMoreInfo={onMoreInfo}
        onAsk={onAsk}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More info" }));
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onMoreInfo).toHaveBeenCalledOnce();
    expect(onAsk).toHaveBeenCalledOnce();
  });

  it("R3.13 renders the range view and threshold card slots", () => {
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        rangeView={<p>range slot</p>}
        thresholdCard={<p>threshold slot</p>}
      />,
    );
    expect(screen.getByText("range slot")).toBeInTheDocument();
    expect(screen.getByText("threshold slot")).toBeInTheDocument();
  });

  it("R3.13 marks the chosen action and the Best actions by NodeAction.index when indexes are not positions (O-198)", () => {
    render(<FeedbackPanel feedback={OFFSET_FEEDBACK} actions={OFFSET_ACTIONS} chosenIndex={11} />);
    expect(screen.getByTestId("feedback-panel")).toHaveTextContent("Your action: Call");
    const table = screen.getByRole("table", { name: "This hand's strategy" });
    expect(within(table).getByRole("row", { name: /Raise 2.5bb/ })).toHaveTextContent("Best");
    expect(within(table).getByRole("row", { name: /All-in 100bb/ })).not.toHaveTextContent("Best");
    expect(within(table).getByRole("row", { name: /Call/ })).not.toHaveTextContent("Best");
  });

  it("R3.13 a chosen position that is not a NodeAction.index renders an alert, not a wrong action (O-198)", () => {
    render(<FeedbackPanel feedback={OFFSET_FEEDBACK} actions={OFFSET_ACTIONS} chosenIndex={1} />);
    expect(screen.getByRole("alert")).toHaveTextContent("chosen action 1");
    expect(screen.queryByText(/Your action/)).not.toBeInTheDocument();
  });

  it("R3.13 a best action index that names no action renders an alert, not a wrong Best row (O-198)", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={OFFSET_ACTIONS} chosenIndex={11} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Best action 2 is not one of the 4 actions");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("R3.13 a chosen index outside the actions renders an error", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={7} />);
    expect(screen.getByRole("alert")).toHaveTextContent("chosen action 7");
  });
});
