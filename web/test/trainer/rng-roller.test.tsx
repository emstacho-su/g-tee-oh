/**
 * Tests for RngRoller, the 1 to 100 strip of cumulative frequency bands (S24, R3.13, O-213). The
 * bands and the selected action come from packages/learning, never from the web.
 */
import { rngBands, rollSelectedAction } from "@g-tee-oh/learning";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RngRoller } from "../../src/components/trainer/index.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";
import { toGradeActions } from "../../src/poker/grade-actions.js";

const FREQUENCIES = fixtureFeedback.freq_by_action;

describe("R3.13 RngRoller", () => {
  it("R3.13 renders one segment per band with its range text and short letter", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={vi.fn()} />);
    const bands = rngBands(FREQUENCIES, toGradeActions(fixtureActions));
    const list = screen.getByRole("list", { name: "RNG bands" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(bands.length);
    expect(items.map((item) => item.getAttribute("data-range"))).toEqual(["1-5", "6-15", "16-95", "96-100"]);
    expect(items[2]).toHaveTextContent("16-95 Raise to 2.5bb");
    expect(items[0]).toHaveAttribute("title", "1-5 Fold");
    expect(within(items[2] as HTMLElement).getByTestId("action-swatch")).toBeInTheDocument();
    expect(screen.queryByText(/selects/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("rng-marker")).not.toBeInTheDocument();
  });

  it("R3.13 a band narrower than the label threshold shows only its swatch, with the full text in a tooltip", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={vi.fn()} />);
    const items = within(screen.getByRole("list", { name: "RNG bands" })).getAllByRole("listitem");
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
    const legend = screen.getByRole("list", { name: "RNG band legend" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "F1-5 Fold",
      "C6-15 Call",
      "R16-95 Raise to 2.5bb",
      "A96-100 All-in 100bb",
    ]);
  });

  it("R3.13 states the roll's selected action and marks it", () => {
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={37} onExplain={vi.fn()} />);
    const roller = screen.getByTestId("rng-roller");
    expect(roller).toHaveTextContent("Roll 37 selects Raise to 2.5bb");
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
      expect(screen.getByTestId("rng-roller")).toHaveTextContent(`Roll ${roll} selects ${label}`);
      expect(screen.getByTestId("rng-roller")).toHaveAttribute("data-selected-index", String(expected));
    },
  );

  it("R3.13 the info button calls onExplain", async () => {
    const onExplain = vi.fn();
    render(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={null} onExplain={onExplain} />);
    await userEvent.click(screen.getByRole("button", { name: "How RNG mode works" }));
    expect(onExplain).toHaveBeenCalledOnce();
  });

  it("R3.13 invalid input renders an error state instead of guessing bands", () => {
    const { rerender } = render(
      <RngRoller actions={fixtureActions} freqByAction={[0.5, 0.5]} roll={null} onExplain={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("RNG bands unavailable");
    rerender(<RngRoller actions={fixtureActions} freqByAction={FREQUENCIES} roll={101} onExplain={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("RNG bands unavailable");
  });
});
