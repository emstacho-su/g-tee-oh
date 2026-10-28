/**
 * Tests for the RNG (random number generator) display around a decision (S25, R3.10, O-282,
 * O-213, O-198): before the decision RollBadge shows only the roll, never a band; after the
 * reveal FeedbackRoller draws the bands from the feedback, labels the roll-selected action Best
 * and alerts when that pick is not one of the grade's best actions.
 */
import { rollSelectedAction } from "@g-tee-oh/learning";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FeedbackRoller, RngRoller, RollBadge } from "../../src/components/trainer/index.js";
import type { DecisionFeedback, NodeAction } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";
import { toGradeActions } from "../../src/poker/grade-actions.js";

/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));
/** Roll 37 lands in Raise's band (16-95) of the fixture frequencies. */
const RAISE_ROLL = 37;
/** Roll 10 lands in Call's band (6-15). */
const CALL_ROLL = 10;

describe("R3.10 RollBadge", () => {
  it("R3.10 shows only the roll before the decision and never a band (O-282)", () => {
    render(<RollBadge roll={RAISE_ROLL} onExplain={vi.fn()} />);
    expect(screen.getByTestId("roll-badge")).toHaveTextContent(`Roll ${RAISE_ROLL}`);
    expect(screen.queryByTestId("rng-roller")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "RNG bands" })).not.toBeInTheDocument();
    expect(screen.queryByText(/selects/)).not.toBeInTheDocument();
    expect(screen.getByTestId("roll-badge")).not.toHaveTextContent(/\d+-\d+/);
  });

  it("R3.10 its info button opens the explainer", async () => {
    const onExplain = vi.fn();
    render(<RollBadge roll={RAISE_ROLL} onExplain={onExplain} />);
    await userEvent.click(screen.getByRole("button", { name: "How RNG mode works" }));
    expect(onExplain).toHaveBeenCalledOnce();
  });
});

describe("R3.10 FeedbackRoller", () => {
  it("R3.10 shows the bands from the feedback's frequencies after the reveal, with the roll marked", () => {
    render(<FeedbackRoller feedback={fixtureFeedback} actions={fixtureActions} onExplain={vi.fn()} />);
    const bands = within(screen.getByRole("list", { name: "RNG bands" })).getAllByRole("listitem");
    expect(bands.map((band) => band.getAttribute("data-range"))).toEqual(["1-5", "6-15", "16-95", "96-100"]);
    expect(screen.getByTestId("rng-roller")).toHaveTextContent(`Roll ${RAISE_ROLL} selects Raise to 2.5bb`);
    expect(screen.getByTestId("rng-marker")).toBeInTheDocument();
  });

  it("R3.10 labels the roll-selected action Best in text next to the strip", () => {
    render(<FeedbackRoller feedback={fixtureFeedback} actions={fixtureActions} onExplain={vi.fn()} />);
    const best = screen.getByTestId("rng-best");
    expect(best).toHaveTextContent(`Best: Raise to 2.5bb, selected by roll ${RAISE_ROLL}`);
    expect(best).toHaveAttribute("data-action-index", "2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.10 the Best pick is rollSelectedAction's, reported as NodeAction.index when indexes are not positions (O-198, O-213)", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, rng_roll: CALL_ROLL, best_action_indexes: [11] };
    render(<FeedbackRoller feedback={feedback} actions={OFFSET_ACTIONS} onExplain={vi.fn()} />);
    const position = rollSelectedAction(feedback.freq_by_action, toGradeActions(OFFSET_ACTIONS), CALL_ROLL);
    const picked = OFFSET_ACTIONS[position] as NodeAction;
    const best = screen.getByTestId("rng-best");
    expect(best).toHaveTextContent(`Best: ${picked.label}, selected by roll ${CALL_ROLL}`);
    expect(best).toHaveAttribute("data-action-index", String(picked.index));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.10 renders an alert, not a Best label, when the pick is not in best_action_indexes", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, best_action_indexes: [1] };
    render(<FeedbackRoller feedback={feedback} actions={fixtureActions} onExplain={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`Roll ${RAISE_ROLL} selects Raise to 2.5bb`);
    expect(alert).toHaveTextContent("the grade marks Call as best");
    expect(screen.queryByTestId("rng-best")).not.toBeInTheDocument();
  });

  it("R3.10 the alert names an unknown best index rather than guessing an action", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, best_action_indexes: [7] };
    render(<FeedbackRoller feedback={feedback} actions={fixtureActions} onExplain={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("the grade marks action 7 as best");
  });

  it("R3.10 renders nothing when the decision had no roll", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, rng_roll: null };
    const { container } = render(<FeedbackRoller feedback={feedback} actions={fixtureActions} onExplain={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("R3.10 leaves invalid input to the roller's own alert and adds no Best label", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, freq_by_action: [0.5, 0.5] };
    render(<FeedbackRoller feedback={feedback} actions={fixtureActions} onExplain={vi.fn()} />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("RNG bands unavailable");
    expect(screen.queryByTestId("rng-best")).not.toBeInTheDocument();
  });

  it("R3.10 the strip's info button opens the explainer", async () => {
    const onExplain = vi.fn();
    render(<FeedbackRoller feedback={fixtureFeedback} actions={fixtureActions} onExplain={onExplain} />);
    await userEvent.click(screen.getByRole("button", { name: "How RNG mode works" }));
    expect(onExplain).toHaveBeenCalledOnce();
  });
});

describe("R3.10 RngRoller without onExplain", () => {
  it("R3.10 renders no info button when no explainer handler is given (the explainer's own example strip)", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={fixtureFeedback.freq_by_action} roll={RAISE_ROLL} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("rng-roller")).toHaveTextContent(`Roll ${RAISE_ROLL} selects Raise to 2.5bb`);
  });
});
