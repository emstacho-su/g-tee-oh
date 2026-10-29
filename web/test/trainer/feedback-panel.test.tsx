/**
 * Tests for the FeedbackPanel shown after a decision (S24, S38, R3.13, O-387, O-388, ADR 0024):
 * a short summary first (the label, your action against the best, the loss, Unrated, the roll),
 * then sections that expand and collapse inline (Strategy, Roll, Range, Where your hand sits,
 * Insights, Explanation), with their defaults and the session's remembered choices.
 */
import { act, render, renderHook, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FEEDBACK_SECTION_TITLES, FeedbackPanel, useFeedbackSections } from "../../src/components/trainer/index.js";
import type { DecisionFeedback, NodeAction } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";

/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));
/** The fixture feedback with its best action (Raise, index 2) renumbered to match OFFSET_ACTIONS. */
const OFFSET_FEEDBACK: DecisionFeedback = { ...fixtureFeedback, best_action_indexes: [12] };
/** A rated decision (the fixture is unrated because it carries a noise flag, S27). */
const RATED: DecisionFeedback = { ...fixtureFeedback, noise_flags: [], rated: true };

function sectionButton(title: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${title}`) });
}

async function openSection(title: string): Promise<void> {
  const button = sectionButton(title);
  if (button.getAttribute("aria-expanded") !== "true") await userEvent.click(button);
}

describe("R3.13 FeedbackPanel summary", () => {
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

  it("R3.13 says your action against the best one, the loss in bb and percent of the pot, and the roll", () => {
    render(<FeedbackPanel feedback={RATED} actions={fixtureActions} chosenIndex={1} />);
    const summary = screen.getByTestId("feedback-summary");
    expect(summary).toHaveTextContent("Your action: Call");
    expect(summary).toHaveTextContent("Best: Raise to 2.5bb");
    expect(summary).toHaveTextContent("Lost 0.01bb (0.73% of the pot)");
    expect(summary).toHaveTextContent("Roll 37");
    expect(summary).not.toHaveTextContent("Unrated");
  });

  it("R3.13 names only the lowest-loss members as best (ADR 0024, O-375)", () => {
    const feedback: DecisionFeedback = { ...RATED, best_action_indexes: [2, 3] };
    render(<FeedbackPanel feedback={feedback} actions={fixtureActions} chosenIndex={1} />);
    expect(screen.getByTestId("feedback-summary")).toHaveTextContent("Best: Raise to 2.5bb or All-in 100bb");
  });

  it("R3.13 says so when the choice is one of the best actions, and when no EV was lost", () => {
    const feedback: DecisionFeedback = { ...RATED, label: "best", ev_loss_bb: 0, ev_loss_pct_pot: 0 };
    render(<FeedbackPanel feedback={feedback} actions={fixtureActions} chosenIndex={2} />);
    const summary = screen.getByTestId("feedback-summary");
    expect(summary).toHaveTextContent("Your action: Raise to 2.5bb");
    expect(summary).toHaveTextContent("You played the best action");
    expect(summary).not.toHaveTextContent("Best: ");
    expect(summary).toHaveTextContent("No EV lost");
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
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} onMoreInfo={onMoreInfo} onAsk={onAsk} />);
    await userEvent.click(screen.getByRole("button", { name: "More info" }));
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onMoreInfo).toHaveBeenCalledOnce();
    expect(onAsk).toHaveBeenCalledOnce();
  });

  it("R3.13 names the chosen and the best actions by NodeAction.index when indexes are not positions (O-198)", () => {
    render(<FeedbackPanel feedback={OFFSET_FEEDBACK} actions={OFFSET_ACTIONS} chosenIndex={11} />);
    const summary = screen.getByTestId("feedback-summary");
    expect(summary).toHaveTextContent("Your action: Call");
    expect(summary).toHaveTextContent("Best: Raise to 2.5bb");
  });

  it("R3.13 a chosen position that is not a NodeAction.index renders an alert, not a wrong action (O-198)", () => {
    render(<FeedbackPanel feedback={OFFSET_FEEDBACK} actions={OFFSET_ACTIONS} chosenIndex={1} />);
    expect(screen.getByRole("alert")).toHaveTextContent("chosen action 1");
    expect(screen.queryByText(/Your action/)).not.toBeInTheDocument();
  });

  it("R3.13 a best action index that names no action renders an alert in the summary, never a wrong Best (O-198)", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={OFFSET_ACTIONS} chosenIndex={11} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Best action 2 is not one of the 4 actions");
    expect(screen.getByTestId("feedback-summary")).not.toHaveTextContent("Best: ");
  });

  it("R3.13 a chosen index outside the actions renders an error", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={7} />);
    expect(screen.getByRole("alert")).toHaveTextContent("chosen action 7");
  });
});

describe("R3.13 FeedbackPanel sections (O-387, O-388)", () => {
  it("R3.13 every given section starts collapsed, as an inline disclosure and never a dialog", () => {
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        rangeView={<p>range slot</p>}
        thresholdCard={<p>threshold slot</p>}
        insights={<p>insights slot</p>}
        explanation={<p>explanation slot</p>}
      />,
    );
    for (const title of [
      FEEDBACK_SECTION_TITLES.strategy,
      FEEDBACK_SECTION_TITLES.range,
      FEEDBACK_SECTION_TITLES.threshold,
      FEEDBACK_SECTION_TITLES.insights,
      FEEDBACK_SECTION_TITLES.explanation,
    ]) {
      expect(sectionButton(title)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByText("range slot")).not.toBeInTheDocument();
    expect(screen.queryByText("threshold slot")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Roll/ })).not.toBeInTheDocument();
  });

  it("R3.13 a section absent from the props has no button", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} />);
    expect(sectionButton(FEEDBACK_SECTION_TITLES.strategy)).toBeInTheDocument();
    for (const title of [FEEDBACK_SECTION_TITLES.range, FEEDBACK_SECTION_TITLES.threshold, FEEDBACK_SECTION_TITLES.insights, FEEDBACK_SECTION_TITLES.explanation]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${title}`) })).not.toBeInTheDocument();
    }
  });

  it("R3.13 Strategy expands inline to the hand's frequencies with the highest-EV actions marked Best (ADR 0024)", async () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} />);
    await openSection(FEEDBACK_SECTION_TITLES.strategy);
    const table = screen.getByRole("table", { name: "This hand's strategy" });
    const raiseRow = within(table).getByRole("row", { name: /Raise to 2.5bb/ });
    expect(raiseRow).toHaveTextContent("80.0%");
    expect(raiseRow).toHaveTextContent("0.62bb");
    expect(raiseRow).toHaveTextContent("Best");
    expect(within(table).getByRole("row", { name: /Fold/ })).not.toHaveTextContent("Best");
  });

  it("R3.13 marks the Best rows by NodeAction.index in the Strategy section (O-198)", async () => {
    render(<FeedbackPanel feedback={OFFSET_FEEDBACK} actions={OFFSET_ACTIONS} chosenIndex={11} />);
    await openSection(FEEDBACK_SECTION_TITLES.strategy);
    const table = screen.getByRole("table", { name: "This hand's strategy" });
    expect(within(table).getByRole("row", { name: /Raise to 2.5bb/ })).toHaveTextContent("Best");
    expect(within(table).getByRole("row", { name: /All-in 100bb/ })).not.toHaveTextContent("Best");
    expect(within(table).getByRole("row", { name: /Call/ })).not.toHaveTextContent("Best");
  });

  it("R3.13 Strategy starts open on a worked-example prompt (O-387)", () => {
    render(<FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} workedExample />);
    expect(sectionButton(FEEDBACK_SECTION_TITLES.strategy)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table", { name: "This hand's strategy" })).toBeInTheDocument();
  });

  it("R3.13 Roll starts open when the roller is given, so the followed-the-roll mark shows at once (O-387, O-371)", () => {
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        roller={<p data-testid="rng-follow">You did not follow the roll</p>}
      />,
    );
    expect(sectionButton(FEEDBACK_SECTION_TITLES.roll)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("rng-follow")).toBeVisible();
  });

  it("R3.13 the range view and threshold card mount only when their section is first opened", async () => {
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        rangeView={<p>range slot</p>}
        thresholdCard={<p>threshold slot</p>}
      />,
    );
    await openSection(FEEDBACK_SECTION_TITLES.range);
    expect(screen.getByText("range slot")).toBeVisible();
    expect(screen.queryByText("threshold slot")).not.toBeInTheDocument();
    await openSection(FEEDBACK_SECTION_TITLES.threshold);
    expect(screen.getByText("threshold slot")).toBeVisible();
  });

  it("R3.13 defaultOpen opens named sections (the gallery's expanded view)", () => {
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        rangeView={<p>range slot</p>}
        defaultOpen={{ range: true, strategy: true }}
      />,
    );
    expect(screen.getByText("range slot")).toBeVisible();
    expect(screen.getByRole("table", { name: "This hand's strategy" })).toBeInTheDocument();
  });

  it("R3.13 a section's open or closed choice carries to the next decision through the session's control (O-387)", async () => {
    const { result } = renderHook(() => useFeedbackSections("session-1"));
    const { rerender } = render(
      <FeedbackPanel feedback={fixtureFeedback} actions={fixtureActions} chosenIndex={1} sections={result.current} />,
    );
    await openSection(FEEDBACK_SECTION_TITLES.strategy);
    expect(result.current.open.strategy).toBe(true);
    const next: DecisionFeedback = { ...fixtureFeedback, attempt_id: "00000000-0000-4000-8000-0000000000ff" };
    rerender(<FeedbackPanel key="next" feedback={next} actions={fixtureActions} chosenIndex={2} sections={result.current} />);
    expect(sectionButton(FEEDBACK_SECTION_TITLES.strategy)).toHaveAttribute("aria-expanded", "true");
  });

  it("R3.13 the remembered choices reset when the session changes", () => {
    const { result, rerender } = renderHook(({ id }) => useFeedbackSections(id), { initialProps: { id: "session-1" } });
    act(() => result.current.setOpen("range", true));
    expect(result.current.open.range).toBe(true);
    rerender({ id: "session-2" });
    expect(result.current.open).toEqual({});
  });

  it("R3.13 a remembered close of Roll wins over its default", () => {
    render(
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={1}
        roller={<p>roller slot</p>}
        sections={{ open: { roll: false }, setOpen: () => undefined }}
      />,
    );
    expect(sectionButton(FEEDBACK_SECTION_TITLES.roll)).toHaveAttribute("aria-expanded", "false");
  });
});
