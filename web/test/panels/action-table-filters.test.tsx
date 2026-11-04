/**
 * Tests for ActionFrequencyTable as a filter and for combos beside percentages (S45, R3.12, O-468,
 * O-469): with onToggle each row header is a button carrying aria-pressed, a click reports the
 * row's NodeAction.index, combos print beside the percent only when given, and a note under the
 * caption carries the range total. Without onToggle the table stays the read-only one the
 * feedback panel uses.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActionFrequencyTable } from "../../src/components/panels/index.js";
import { fixtureActions } from "../../src/fixtures/index.js";
import { formatCombos } from "../../src/poker/format.js";

const SHARES = [0.55, 0.05, 0.38, 0.02];
const COMBOS = [729.3, 66.3, 503.9, 26.5];

describe("R3.12 action rows as filters", () => {
  it("R3.12 with onToggle every row header is a button with aria-pressed, and a click reports the action's index", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="c" pressedIndexes={[2]} onToggle={onToggle} />);
    const buttons = screen.getAllByRole("button", { pressed: false });
    expect(buttons).toHaveLength(3);
    const raise = screen.getByRole("button", { name: /Raise to 2.5bb/ });
    expect(raise).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Fold/ }));
    expect(onToggle).toHaveBeenCalledWith(0);
    expect(screen.getByRole("row", { name: /Raise to 2.5bb/ })).toHaveAttribute("data-pressed", "true");
  });

  it("R3.12 without onToggle no row is a button", () => {
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="c" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("R3.12 prints the combos beside the percent when given, whole combos, and nothing when not", () => {
    const { rerender } = render(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="c" combos={COMBOS} />);
    const raise = screen.getByRole("row", { name: /Raise to 2.5bb/ });
    expect(raise).toHaveTextContent("38.0%, 504 combos");
    expect(screen.getByRole("row", { name: /Fold/ })).toHaveTextContent("55.0%, 729 combos");
    rerender(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="c" combos={[null, null, null, null]} />);
    expect(screen.getByRole("row", { name: /Raise to 2.5bb/ })).not.toHaveTextContent("combos");
    rerender(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="c" />);
    expect(screen.getByRole("row", { name: /Raise to 2.5bb/ })).not.toHaveTextContent("combos");
  });

  it("R3.12 a combos list of another length is a mismatch alert, never a wrong number", () => {
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="c" combos={[1, 2]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("4 actions but 2 combo counts");
  });

  it("R3.12 a note under the caption carries the range total", () => {
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={SHARES} caption="Range by action" note="1,326 of 1,326 combos reach this node" />);
    const table = screen.getByRole("table", { name: /Range by action/ });
    expect(within(table).getByText("1,326 of 1,326 combos reach this node")).toBeInTheDocument();
  });

  it("R3.12 formatCombos prints whole combos with a thousands separator and the singular", () => {
    expect(formatCombos(503.9)).toBe("504 combos");
    expect(formatCombos(1)).toBe("1 combo");
    expect(formatCombos(1326)).toBe("1,326 combos");
    expect(formatCombos(0.4)).toBe("0 combos");
  });
});
