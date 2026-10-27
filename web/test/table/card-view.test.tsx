/** Tests for CardView, one playing card with rank, suit symbol and an accessible name (S24, R3.13). */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardView } from "../../src/components/table/index.js";

describe("R3.13 CardView", () => {
  it("R3.13 shows rank and suit symbol with the card's accessible name", () => {
    render(<CardView card="Ah" />);
    const card = screen.getByRole("img", { name: "Ace of hearts" });
    expect(card).toHaveAttribute("data-testid", "card-view");
    expect(card).toHaveTextContent("A");
    expect(card).toHaveTextContent("♥");
  });

  it("R3.13 prints a ten as 10", () => {
    render(<CardView card="Td" size="lg" />);
    expect(screen.getByRole("img", { name: "Ten of diamonds" })).toHaveTextContent("10♦");
  });

  it("R3.13 names a face-down card and hides its face", () => {
    render(<CardView faceDown size="sm" />);
    const card = screen.getByRole("img", { name: "Face-down card" });
    expect(card).not.toHaveTextContent("♥");
    expect(card).toHaveAttribute("data-face", "down");
  });

  it("R3.13 a missing card renders face down", () => {
    render(<CardView />);
    expect(screen.getByRole("img", { name: "Face-down card" })).toBeInTheDocument();
  });

  it("R3.13 four-color suits give diamonds and clubs their own color class", () => {
    const { rerender } = render(<CardView card="Kd" />);
    const twoColor = screen.getByRole("img", { name: "King of diamonds" }).getAttribute("data-suit-color");
    rerender(<CardView card="Kd" fourColor />);
    const fourColor = screen.getByRole("img", { name: "King of diamonds" }).getAttribute("data-suit-color");
    expect(twoColor).toBe("red");
    expect(fourColor).toBe("blue");
    rerender(<CardView card="2c" fourColor />);
    expect(screen.getByRole("img", { name: "Two of clubs" })).toHaveAttribute("data-suit-color", "green");
    rerender(<CardView card="2c" />);
    expect(screen.getByRole("img", { name: "Two of clubs" })).toHaveAttribute("data-suit-color", "black");
  });

  it("R3.13 an invalid card string renders a named error card instead of throwing", () => {
    render(<CardView card="Zz" />);
    expect(screen.getByRole("img", { name: 'Invalid card "Zz"' })).toHaveTextContent("?");
  });
});
