/**
 * Tests for ThresholdCard, the generic and safe view of StudyInsights.threshold_card (S24, R3.12).
 * S23 pins the inner shape, so the card renders any JSON value as text and never as HTML.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThresholdCard } from "../../src/components/panels/index.js";
import { fixtureInsights } from "../../src/fixtures/index.js";

describe("R3.12 ThresholdCard", () => {
  it("R3.12 renders nested objects as definition lists with readable keys", () => {
    render(<ThresholdCard card={fixtureInsights.threshold_card} />);
    const card = screen.getByTestId("threshold-card");
    expect(within(card).getByRole("heading", { name: "Threshold card" })).toBeInTheDocument();
    expect(within(card).getAllByText("weakest hand taking half")).toHaveLength(2);
    expect(within(card).getByText("K9o")).toBeInTheDocument();
    expect(within(card).getByText("0.52")).toBeInTheDocument();
    expect(card.querySelectorAll("dl").length).toBeGreaterThanOrEqual(4);
  });

  it("R3.12 shows the hero hand and marks values equal to it", () => {
    render(<ThresholdCard card={fixtureInsights.threshold_card} heroHand="AJo" />);
    const card = screen.getByTestId("threshold-card");
    expect(card).toHaveTextContent("Your hand: AJo");
    const match = within(card).getByText("AJo", { selector: "dd *" });
    expect(match).toHaveAttribute("data-hero", "true");
  });

  it("R3.12 a node without a threshold card says so (S23: the card is nullable)", () => {
    render(<ThresholdCard card={null} />);
    expect(screen.getByTestId("threshold-card")).toHaveTextContent("No threshold data for this node");
  });

  it("R3.12 renders arrays, booleans and null as text", () => {
    render(<ThresholdCard card={{ hands: ["AA", "KK"], mixed: true, missing: null, count: 3 }} />);
    const card = screen.getByTestId("threshold-card");
    expect(within(card).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["AA", "KK"]);
    expect(card).toHaveTextContent("yes");
    expect(card).toHaveTextContent("none");
    expect(card).toHaveTextContent("3");
  });

  it("R3.12 never renders strings as HTML", () => {
    render(<ThresholdCard card={{ note: "<img src=x onerror=alert(1)>" }} />);
    const card = screen.getByTestId("threshold-card");
    expect(card.querySelector("img")).toBeNull();
    expect(card).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("R3.12 stops at a depth limit instead of recursing without end", () => {
    let deep: Record<string, unknown> = { leaf: "bottom" };
    for (let level = 0; level < 12; level += 1) deep = { [`level_${level}`]: deep };
    render(<ThresholdCard card={deep} />);
    const card = screen.getByTestId("threshold-card");
    expect(card).toHaveTextContent("nested too deep");
    expect(card).not.toHaveTextContent("bottom");
  });

  it("R3.12 an empty object shows the no-data message and a custom title", () => {
    render(<ThresholdCard card={{}} title="Raise threshold" />);
    const card = screen.getByTestId("threshold-card");
    expect(within(card).getByRole("heading", { name: "Raise threshold" })).toBeInTheDocument();
    expect(card).toHaveTextContent("No threshold data for this node");
  });

  it("R3.12 a value that is not JSON renders a placeholder", () => {
    render(<ThresholdCard card={{ odd: () => 1, gone: undefined }} />);
    expect(screen.getAllByText("unsupported value")).toHaveLength(2);
  });
});
