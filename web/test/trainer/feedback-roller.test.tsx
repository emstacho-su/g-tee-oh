/**
 * Tests for the Mixed-frequency mode display around a decision (S25, S37, R3.10, ADR 0024, O-344,
 * O-371, O-213, O-198): before the decision the roll scale shows only the roll (rng-roller.test.tsx
 * covers the hidden state); after the reveal FeedbackRoller shows the same scale with the bands from
 * the feedback and a separate followed-the-roll mark, in words and an icon, never a Best label. The
 * mark is the grade's (feedback.followed_roll); the web recomputes it with learning's followsRoll and
 * alerts when the two disagree, so a drift is visible.
 */
import { followsRoll } from "@g-tee-oh/learning";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FeedbackRoller, RngRoller } from "../../src/components/trainer/index.js";
import type { DecisionFeedback, NodeAction } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";
import { toGradeActions } from "../../src/poker/grade-actions.js";

/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));
/** Roll 37 lands in Raise's band (16-95) of the fixture frequencies. */
const RAISE_ROLL = 37;
/** Roll 10 lands in Call's band (6-15). */
const CALL_ROLL = 10;
const RAISE_INDEX = 2;
const CALL_INDEX = 1;

interface RenderOptions {
  feedback?: DecisionFeedback;
  actions?: readonly NodeAction[];
  chosenIndex?: number;
  onExplain?: () => void;
}

function renderRoller(options: RenderOptions = {}) {
  return render(
    <FeedbackRoller
      feedback={options.feedback ?? fixtureFeedback}
      actions={options.actions ?? fixtureActions}
      chosenIndex={options.chosenIndex ?? RAISE_INDEX}
      grouping="standard"
      street="preflop"
      onExplain={options.onExplain ?? vi.fn()}
    />,
  );
}

describe("R3.10 FeedbackRoller", () => {
  it("R3.10 reveals the bands from the feedback's frequencies on the same scale, with the roll marked (ADR 0024 rule 3)", () => {
    renderRoller();
    const roller = screen.getByTestId("rng-roller");
    expect(roller).toHaveAttribute("data-revealed", "true");
    const bands = within(screen.getByRole("list", { name: "Mixed-frequency bands" })).getAllByRole("listitem");
    expect(bands.map((band) => band.getAttribute("data-range"))).toEqual(["1-5", "6-15", "16-95", "96-100"]);
    expect(roller).toHaveTextContent(`Roll ${RAISE_ROLL} fell on Raise to 2.5bb`);
    expect(screen.getByTestId("rng-marker")).toBeInTheDocument();
  });

  it("R3.10 a followed roll shows a check and words, never Best and never color alone (O-344, O-371)", () => {
    renderRoller({ feedback: { ...fixtureFeedback, followed_roll: true }, chosenIndex: RAISE_INDEX });
    const mark = screen.getByTestId("rng-follow");
    expect(mark).toHaveAttribute("data-followed", "true");
    expect(within(mark).getByText("✓")).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveTextContent(`You followed the roll: roll ${RAISE_ROLL} fell on Raise to 2.5bb`);
    expect(screen.queryByTestId("rng-best")).not.toBeInTheDocument();
    expect(screen.getByTestId("feedback-roller")).not.toHaveTextContent(/Best/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.10 a roll not followed shows a cross, where the roll fell and what was chosen (O-344, O-371)", () => {
    renderRoller({ feedback: { ...fixtureFeedback, followed_roll: false }, chosenIndex: CALL_INDEX });
    const mark = screen.getByTestId("rng-follow");
    expect(mark).toHaveAttribute("data-followed", "false");
    expect(within(mark).getByText("✗")).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveTextContent(`You did not follow the roll: roll ${RAISE_ROLL} fell on Raise to 2.5bb, you chose Call`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.10 the mark agrees with learning's followsRoll when indexes are not positions (O-198, O-213)", () => {
    const feedback: DecisionFeedback = { ...fixtureFeedback, rng_roll: CALL_ROLL, followed_roll: true };
    renderRoller({ feedback, actions: OFFSET_ACTIONS, chosenIndex: CALL_INDEX + 10 });
    const expected = followsRoll({
      freqByAction: feedback.freq_by_action,
      actions: toGradeActions(OFFSET_ACTIONS),
      street: "preflop",
      roll: CALL_ROLL,
      actionIndex: CALL_INDEX,
    });
    expect(expected).toBe(true);
    expect(screen.getByTestId("rng-follow")).toHaveAttribute("data-followed", "true");
    expect(screen.getByTestId("rng-follow")).toHaveTextContent(`roll ${CALL_ROLL} fell on Call`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.10 renders an alert when the grade's mark disagrees with the scale's own reading (O-213)", () => {
    renderRoller({ feedback: { ...fixtureFeedback, followed_roll: false }, chosenIndex: RAISE_INDEX });
    expect(screen.getByRole("alert")).toHaveTextContent("The roll scale and the grade disagree on whether you followed the roll");
    expect(screen.queryByTestId("rng-follow")).not.toBeInTheDocument();
  });

  it("R3.10 an attempt stored before the mark existed (followed_roll null) shows the scale's own reading", () => {
    renderRoller({ feedback: { ...fixtureFeedback, followed_roll: null }, chosenIndex: RAISE_INDEX });
    expect(screen.getByTestId("rng-follow")).toHaveAttribute("data-followed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R3.10 renders nothing when the decision had no roll", () => {
    const { container } = renderRoller({ feedback: { ...fixtureFeedback, rng_roll: null, followed_roll: null } });
    expect(container).toBeEmptyDOMElement();
  });

  it("R3.10 leaves invalid input to the scale's own alert and adds no mark", () => {
    renderRoller({ feedback: { ...fixtureFeedback, freq_by_action: [0.5, 0.5] } });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Mixed-frequency bands unavailable");
    expect(screen.queryByTestId("rng-follow")).not.toBeInTheDocument();
  });

  it("R3.10 the scale's info button opens the explainer", async () => {
    const onExplain = vi.fn();
    renderRoller({ onExplain });
    await userEvent.click(screen.getByRole("button", { name: "How Mixed-frequency mode works" }));
    expect(onExplain).toHaveBeenCalledOnce();
  });
});

describe("R3.10 RngRoller without onExplain", () => {
  it("R3.10 renders no info button when no explainer handler is given (the explainer's own example strip)", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={fixtureFeedback.freq_by_action} roll={RAISE_ROLL} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("rng-roller")).toHaveTextContent(`Roll ${RAISE_ROLL} fell on Raise to 2.5bb`);
  });
});
