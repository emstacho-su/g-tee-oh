/**
 * Tests for RngRoller, the 1 to 100 roll scale of Mixed-frequency mode (S24, S37, R3.10, R3.13,
 * O-213, O-344, O-376): hidden before the decision (the roll alone), revealed after it (the bands). The
 * bands and the selected action come from packages/learning, never from the web.
 */
import { rngBands, rollSelectedAction } from "@g-tee-oh/learning";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RngRoller } from "../../src/components/trainer/index.js";
import type { NodeAction } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";
import { toGradeActions } from "../../src/poker/grade-actions.js";

const FREQUENCIES = fixtureFeedback.freq_by_action;
/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));

describe("R3.13 RngRoller", () => {
  it("R3.13 renders one segment per band with its range text and short letter", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={vi.fn()} />);
    const bands = rngBands(FREQUENCIES, toGradeActions(fixtureActions));
    const list = screen.getByRole("list", { name: "Mixed-frequency bands" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(bands.length);
    expect(items.map((item) => item.getAttribute("data-range"))).toEqual(["1-5", "6-15", "16-95", "96-100"]);
    expect(items[2]).toHaveTextContent("16-95 Raise to 2.5bb");
    expect(items[0]).toHaveAttribute("title", "1-5 Fold");
    expect(within(items[2] as HTMLElement).getByTestId("action-swatch")).toBeInTheDocument();
    expect(screen.queryByText(/fell on/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("rng-marker")).not.toBeInTheDocument();
  });

  it("R3.13 a band narrower than the label threshold shows only its swatch, with the full text in a tooltip", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={vi.fn()} />);
    const items = within(screen.getByRole("list", { name: "Mixed-frequency bands" })).getAllByRole("listitem");
    // 1-5 Fold and 6-15 Call are 5 and 10 rolls wide, under the threshold; 16-95 Raise is 80 wide.
    for (const [index, text] of [[0, "1-5 Fold"], [1, "6-15 Call"], [3, "96-100 All-in 100bb"]] as const) {
      const item = items[index] as HTMLElement;
      expect(item).toHaveAttribute("title", text);
      expect(within(item).getByTestId("action-swatch")).toBeInTheDocument();
      expect(within(item).queryByTestId("rng-band-label")).not.toBeInTheDocument();
    }
    expect(within(items[2] as HTMLElement).getByTestId("rng-band-label")).toHaveTextContent("16-95 Raise to 2.5bb");
  });

  it("R3.13 the legend under the strip lists every band in full, so a narrow band loses no text", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={vi.fn()} />);
    const legend = screen.getByRole("list", { name: "Mixed-frequency band legend" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "F1-5 Fold",
      "C6-15 Call",
      "R16-95 Raise to 2.5bb",
      "A96-100 All-in 100bb",
    ]);
  });

  it("R3.13 states where the roll fell and marks that band", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={37} onExplain={vi.fn()} />);
    const roller = screen.getByTestId("rng-roller");
    expect(roller).toHaveTextContent("Roll 37 fell on Raise to 2.5bb");
    expect(screen.getByTestId("rng-marker")).toBeInTheDocument();
    const current = within(roller).getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("data-range", "16-95");
  });

  it.each([1, 5, 6, 15, 16, 37, 95, 96, 100])(
    "R3.13 the selected action equals rollSelectedAction's for roll %i",
    (roll) => {
      render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={roll} onExplain={vi.fn()} />);
      const expected = rollSelectedAction(FREQUENCIES, toGradeActions(fixtureActions), roll);
      const label = fixtureActions[expected]?.label ?? "";
      expect(screen.getByTestId("rng-roller")).toHaveTextContent(`Roll ${roll} fell on ${label}`);
      expect(screen.getByTestId("rng-roller")).toHaveAttribute("data-selected-index", String(expected));
    },
  );

  it.each([1, 6, 37, 96])(
    "R3.13 with indexes that are not positions, roll %i selects rollSelectedAction's action and reports its NodeAction.index (O-198)",
    (roll) => {
      render(<RngRoller actions={OFFSET_ACTIONS} freqByAction={FREQUENCIES} roll={roll} onExplain={vi.fn()} />);
      const position = rollSelectedAction(FREQUENCIES, toGradeActions(OFFSET_ACTIONS), roll);
      const action = OFFSET_ACTIONS[position] as NodeAction;
      const roller = screen.getByTestId("rng-roller");
      expect(roller).toHaveTextContent(`Roll ${roll} fell on ${action.label}`);
      expect(roller).toHaveAttribute("data-selected-index", String(action.index));
      const current = within(roller).getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "true");
      expect(current.map((item) => item.getAttribute("data-action-index"))).toEqual([String(action.index)]);
    },
  );

  it("R3.13 with indexes that are not positions, the bands still match rngBands and carry NodeAction.index (O-198)", () => {
    render(<RngRoller actions={OFFSET_ACTIONS} freqByAction={FREQUENCIES} roll={null} onExplain={vi.fn()} />);
    const bands = rngBands(FREQUENCIES, toGradeActions(OFFSET_ACTIONS));
    const items = within(screen.getByRole("list", { name: "Mixed-frequency bands" })).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-range"))).toEqual(bands.map((band) => `${band.from}-${band.to}`));
    expect(items.map((item) => item.getAttribute("data-action-index"))).toEqual(
      bands.map((band) => String(OFFSET_ACTIONS[band.actionIndex]?.index)),
    );
    expect(items[2]).toHaveTextContent("16-95 Raise to 2.5bb");
  });

  it("R3.13 the info button calls onExplain", async () => {
    const onExplain = vi.fn();
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={onExplain} />);
    await userEvent.click(screen.getByRole("button", { name: "How Mixed-frequency mode works" }));
    expect(onExplain).toHaveBeenCalledOnce();
  });

  it("R3.10 before the decision the scale shows the roll on 1 to 100 with ticks, and no band, action or frequency (ADR 0024 rule 3, O-344)", () => {
    const onExplain = vi.fn();
    render(<RngRoller hidden roll={37} onExplain={onExplain} />);
    const roller = screen.getByTestId("rng-roller");
    expect(roller).toHaveAttribute("data-revealed", "false");
    expect(within(roller).getByTestId("rng-roll-label")).toHaveTextContent("Roll 37");
    expect(screen.getByTestId("rng-marker")).toBeInTheDocument();
    expect(within(roller).getByRole("img", { name: "Roll 37 on a scale from 1 to 100" })).toBeInTheDocument();
    expect(within(roller).getAllByTestId("rng-tick").map((tick) => tick.textContent)).toEqual(["1", "25", "50", "75", "100"]);
    expect(screen.queryByRole("list", { name: "Mixed-frequency bands" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Mixed-frequency band legend" })).not.toBeInTheDocument();
    for (const action of fixtureActions) expect(roller).not.toHaveTextContent(action.label);
    expect(roller).not.toHaveTextContent(/fell on/);
    expect(roller).not.toHaveAttribute("data-selected-index");
  });

  it("R3.10 the hidden and the revealed scale put the roll marker at the same place (O-376)", () => {
    const { unmount } = render(<RngRoller hidden roll={37} />);
    const hiddenLeft = screen.getByTestId("rng-marker").style.left;
    unmount();
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={37} />);
    expect(screen.getByTestId("rng-marker").style.left).toBe(hiddenLeft);
    expect(screen.getByTestId("rng-roll-label")).toHaveTextContent("Roll 37");
  });

  it("R3.10 after the decision the bands grow in from the left by a transition, and reduced motion shows them at once (O-376)", async () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={37} />);
    const roller = screen.getByTestId("rng-roller");
    expect(roller).toHaveAttribute("data-revealed", "true");
    const bands = screen.getByRole("list", { name: "Mixed-frequency bands" });
    expect(bands).toHaveClass("motion-safe:transition-[clip-path]", "motion-reduce:transition-none");
    await waitFor(() => expect(bands).toHaveAttribute("data-reveal", "done"));
  });

  it("R3.13 invalid input renders an error state instead of guessing bands", () => {
    const { rerender } = render(
      <RngRoller actions={fixtureActions} freqByAction={[0.5, 0.5]} roll={null} onExplain={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Mixed-frequency bands unavailable");
    rerender(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={101} onExplain={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Mixed-frequency bands unavailable");
  });
});
