/** Tests for ActionFrequencyTable, the study and feedback frequency panel (S24, R3.12). */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionFrequencyTable } from "../../src/components/panels/index.js";
import type { NodeAction } from "../../src/contracts.js";
import { fixtureActions, fixtureFeedback } from "../../src/fixtures/index.js";

/** The fixture actions numbered 10 to 13, so a NodeAction.index never equals its position (O-198). */
const OFFSET_ACTIONS: readonly NodeAction[] = fixtureActions.map((action) => ({ ...action, index: action.index + 10 }));

describe("R3.12 ActionFrequencyTable", () => {
  it("R3.12 is a real table with a caption, column headers and row headers", () => {
    render(
      <ActionFrequencyTable
        actions={fixtureActions}
        frequencies={fixtureFeedback.freq_by_action}
        caption="Node strategy"
      />,
    );
    const table = screen.getByRole("table", { name: "Node strategy" });
    expect(table).toHaveAttribute("data-testid", "action-frequency-table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Action", "Frequency"]);
    expect(headers[0]).toHaveAttribute("scope", "col");
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(fixtureActions.length);
    expect(rowHeaders[0]).toHaveAttribute("scope", "row");
  });

  it("R3.12 each row shows swatch, short letter, name and size, frequency and a bar", () => {
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={fixtureFeedback.freq_by_action} caption="c" />);
    const raise = screen.getByRole("row", { name: /Raise 2.5bb/ });
    expect(within(raise).getByTestId("action-swatch")).toHaveAttribute("data-pattern", "diagonal");
    expect(within(raise).getByText("R")).toBeInTheDocument();
    expect(raise).toHaveTextContent("80.0%");
    expect(within(raise).getByTestId("frequency-bar")).toHaveStyle({ width: "80%" });
  });

  it("R3.12 shows EV in bb when given and marks highlighted rows in text: the highest-EV row is the Best one (ADR 0024)", () => {
    render(
      <ActionFrequencyTable
        actions={fixtureActions}
        frequencies={fixtureFeedback.freq_by_action}
        evBb={fixtureFeedback.ev_by_action}
        highlightIndexes={[2]}
        caption="c"
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Action",
      "Frequency",
      "EV",
    ]);
    const raise = screen.getByRole("row", { name: /Raise 2.5bb/ });
    expect(raise).toHaveTextContent("0.62bb");
    expect(raise).toHaveTextContent("Best");
    expect(raise).toHaveAttribute("data-highlight", "true");
    expect(screen.getByRole("row", { name: /All-in 100bb/ })).toHaveTextContent("-0.40bb");
    expect(screen.getByRole("row", { name: /Fold/ })).not.toHaveTextContent("Best");
  });

  it("R3.12 uses a custom highlight label", () => {
    render(
      <ActionFrequencyTable
        actions={fixtureActions}
        frequencies={fixtureFeedback.freq_by_action}
        highlightIndexes={[0]}
        highlightLabel="Hero"
        caption="c"
      />,
    );
    expect(screen.getByRole("row", { name: /Fold/ })).toHaveTextContent("Hero");
  });

  it("R3.12 highlights rows by NodeAction.index, not by position, while frequencies stay positional (O-198)", () => {
    render(
      <ActionFrequencyTable
        actions={OFFSET_ACTIONS}
        frequencies={fixtureFeedback.freq_by_action}
        evBb={fixtureFeedback.ev_by_action}
        highlightIndexes={[12]}
        caption="c"
      />,
    );
    const raise = screen.getByRole("row", { name: /Raise 2.5bb/ });
    expect(raise).toHaveAttribute("data-highlight", "true");
    expect(raise).toHaveTextContent("80.0%");
    expect(raise).toHaveTextContent("0.62bb");
    const highlighted = screen.getAllByRole("row").filter((row) => row.getAttribute("data-highlight") === "true");
    expect(highlighted).toEqual([raise]);
  });

  it("R3.12 a highlight index that names no action renders an alert, not a wrong row (O-198)", () => {
    render(
      <ActionFrequencyTable
        actions={OFFSET_ACTIONS}
        frequencies={fixtureFeedback.freq_by_action}
        highlightIndexes={[2]}
        caption="c"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Best action 2 is not one of the 4 actions");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("R3.12 R3.13 keeps the column headers for screen readers but hides them visually, so it reads as a list (row 14)", () => {
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={fixtureFeedback.freq_by_action} caption="c" />);
    const head = screen.getByRole("table").querySelector("thead");
    expect(head).not.toBeNull();
    expect(head).toHaveClass("sr-only");
  });

  it("R3.12 R3.13 draws one combined mix bar on top, a segment per action at its share, hidden from screen readers", () => {
    render(<ActionFrequencyTable actions={fixtureActions} frequencies={fixtureFeedback.freq_by_action} caption="c" />);
    const mix = screen.getByTestId("frequency-mix");
    expect(mix).toHaveAttribute("aria-hidden", "true");
    const segments = within(mix).getAllByTestId("frequency-mix-segment");
    const shown = fixtureFeedback.freq_by_action.filter((share) => share > 0);
    expect(segments).toHaveLength(shown.length);
    expect(segments[segments.length - 1]).toHaveStyle({ width: `${(shown[shown.length - 1] ?? 0) * 100}%` });
  });

  it("R3.12 R3.13 shows Best as a chip in the row", () => {
    render(
      <ActionFrequencyTable actions={fixtureActions} frequencies={fixtureFeedback.freq_by_action} highlightIndexes={[2]} caption="c" />,
    );
    const raise = screen.getByRole("row", { name: /Raise 2.5bb/ });
    expect(within(raise).getByTestId("highlight-chip")).toHaveTextContent("Best");
  });

  it("R3.12 rejects mismatched lengths and frequencies outside 0 to 1", () => {
    const { rerender } = render(<ActionFrequencyTable actions={fixtureActions} frequencies={[0.5, 0.5]} caption="c" />);
    expect(screen.getByRole("alert")).toHaveTextContent("4 actions but 2 frequencies");
    rerender(
      <ActionFrequencyTable actions={fixtureActions} frequencies={[0.25, 0.25, 0.25, 0.25]} evBb={[1]} caption="c" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("4 actions but 1 EV values");
    rerender(<ActionFrequencyTable actions={fixtureActions} frequencies={[1.5, 0, 0, 0]} caption="c" />);
    expect(screen.getByRole("alert")).toHaveTextContent("frequency 1.5 is outside 0 to 1");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
