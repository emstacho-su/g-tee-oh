/**
 * Tests for the graded paint view (S27 lane B, R3.17, O-300, ADR 0004): the read-only grid with
 * each class's painted and best action as text, the loss shading and its legend, the total and the
 * costliest classes table, every number copied from the response.
 */
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PaintGradedView } from "../../src/components/painter/PaintGradedView.js";
import { costliest } from "../../src/components/painter/paint-model.js";
import { fixturePaintGraded, fixturePaintPrompt } from "../../src/fixtures/paint.js";
import { formatBb } from "../../src/poker/format.js";

function setup() {
  const onNext = vi.fn();
  render(<PaintGradedView prompt={fixturePaintPrompt} result={fixturePaintGraded} onNext={onNext} />);
  return { onNext, user: userEvent.setup() };
}

describe("R3.17 PaintGradedView", () => {
  it("R3.17 shows the total weighted EV loss from the response and the unrated note", () => {
    setup();
    const total = screen.getByTestId("paint-total");
    expect(total).toHaveTextContent(formatBb(fixturePaintGraded.total_weighted_loss_bb, 4));
    expect(screen.getByText(/unrated/i)).toBeInTheDocument();
  });

  it("R3.17 lists the costliest classes, at most ten, costliest first, with the response's numbers", () => {
    setup();
    const table = screen.getByRole("table", { name: /costliest/i });
    const rows = within(table).getAllByRole("row").slice(1);
    const expected = costliest(fixturePaintGraded.per_hand);
    expect(rows).toHaveLength(Math.min(10, expected.length));
    const first = expected[0];
    if (first === undefined) throw new Error("the fixture grade has no loss");
    expect(rows[0]).toHaveTextContent(first.hand);
    expect(rows[0]).toHaveTextContent(formatBb(first.weighted_loss_bb, 4));
    expect(rows[0]).toHaveTextContent(formatBb(first.loss_bb, 2));
  });

  it("R3.17 each graded cell names its painted and the solver's action and its weighted loss as text", () => {
    setup();
    const grid = screen.getByRole("grid", { name: /graded range/i });
    const kk = within(grid).getByTitle(/^QQ:/);
    expect(kk.getAttribute("title")).toMatch(/painted Call, solver Raise to 10bb, weighted loss \d+\.\d{4}bb/);
    expect(kk).toHaveAttribute("data-shade");
    expect(within(grid).getByTitle(/^72o:/).getAttribute("title")).toBe("72o: not in range");
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(169);
  });

  it("R3.17 shows a legend for every loss shade", () => {
    setup();
    const legend = screen.getByRole("list", { name: /loss shading/i });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(4);
  });

  it("R3.17 Next asks for the next prompt", async () => {
    const { user, onNext } = setup();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});

describe("R3.17 PaintGradedView edge cases", () => {
  it("R3.17 a paint that loses nothing says so instead of a costliest table", () => {
    const lossless = {
      ...fixturePaintGraded,
      total_weighted_loss_bb: 0,
      per_hand: fixturePaintGraded.per_hand.map((row) => ({
        ...row,
        action_index: row.best_action_index,
        loss_bb: 0,
        loss_pct_pot: 0,
        weighted_loss_bb: 0,
      })),
    };
    render(<PaintGradedView prompt={fixturePaintPrompt} result={lossless} onNext={vi.fn()} />);
    expect(screen.queryByRole("table", { name: /costliest/i })).toBeNull();
    expect(screen.getByText(/loses nothing/i)).toBeInTheDocument();
  });

  it("R3.17 an action index the prompt does not name is shown as Action n and a question mark, never a wrong label", () => {
    const first = fixturePaintGraded.per_hand[0];
    if (first === undefined) throw new Error("the fixture grade has no rows");
    const unknown = {
      ...fixturePaintGraded,
      per_hand: [{ ...first, action_index: 9, weighted_loss_bb: 0.5 }, ...fixturePaintGraded.per_hand.slice(1)],
    };
    render(<PaintGradedView prompt={fixturePaintPrompt} result={unknown} onNext={vi.fn()} />);
    const grid = screen.getByRole("grid", { name: /graded range/i });
    const cell = within(grid).getByTitle(new RegExp(`^${first.hand}:`));
    expect(cell.getAttribute("title")).toContain("painted Action 9");
    expect(cell).toHaveTextContent("?");
  });
});
