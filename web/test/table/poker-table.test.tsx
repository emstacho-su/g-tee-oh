/** Tests for PokerTable, the oval felt with 6 to 9 seats (S24, R3.13). */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PokerTable, seatLayout, type TableSeat } from "../../src/components/table/index.js";
import { fixturePrompt } from "../../src/fixtures/index.js";

const SIX_POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;

function sixSeats(): TableSeat[] {
  return SIX_POSITIONS.map((position, index) => ({
    position,
    stackCbb: fixturePrompt.stacks_cbb[index] ?? 0,
    isHero: position === fixturePrompt.hero_position,
    hasFolded: index < 3,
    isButton: position === "BTN",
    isStraddle: false,
    ...(position === "SB" ? { betCbb: 50 } : {}),
    ...(position === "BB" ? { betCbb: 100 } : {}),
    ...(position === fixturePrompt.hero_position ? { cards: ["Ah", "Jd"] as const } : {}),
  }));
}

describe("R3.13 PokerTable", () => {
  it("R3.13 names the table by seat count and pot", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    const table = screen.getByRole("group", { name: "Table, 6 seats, pot 1.5bb" });
    expect(table).toHaveAttribute("data-testid", "poker-table");
    expect(within(table).getByText("Pot 1.5bb")).toBeInTheDocument();
  });

  it("R3.13 shows each seat's position, stack and bet", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    const bigBlind = screen.getByTestId("seat-BB");
    expect(bigBlind).toHaveTextContent("BB");
    expect(bigBlind).toHaveTextContent("99bb");
    expect(bigBlind).toHaveTextContent("Bet 1bb");
    expect(screen.getByTestId("seat-UTG")).not.toHaveTextContent("Bet");
  });

  it("R3.13 marks the button, the hero and the hero's cards", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    const button = screen.getByTestId("seat-BTN");
    expect(within(button).getByText("D")).toBeInTheDocument();
    expect(within(button).getByText("Dealer button")).toBeInTheDocument();
    expect(within(button).getByText("Hero")).toBeInTheDocument();
    expect(within(button).getByRole("img", { name: "Ace of hearts" })).toBeInTheDocument();
    expect(within(button).getByRole("img", { name: "Jack of diamonds" })).toBeInTheDocument();
    expect(within(screen.getByTestId("seat-CO")).queryByText("D")).not.toBeInTheDocument();
  });

  it("R3.13 dims folded seats and says Folded", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    const folded = screen.getByTestId("seat-UTG");
    expect(folded).toHaveTextContent("Folded");
    expect(folded).toHaveAttribute("data-folded", "true");
    expect(screen.getByTestId("seat-SB")).not.toHaveTextContent("Folded");
  });

  it("R3.13 marks the straddler with STR", () => {
    const seats = sixSeats().map((seat) => (seat.position === "UTG" ? { ...seat, isStraddle: true, hasFolded: false } : seat));
    render(<PokerTable seats={seats} potCbb={350} />);
    const straddler = screen.getByTestId("seat-UTG");
    expect(within(straddler).getByText("STR")).toBeInTheDocument();
    expect(within(straddler).getByText("Straddle")).toBeInTheDocument();
  });

  it("R3.13 accepts nine seats and renders a center slot", () => {
    const positions = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;
    const seats: TableSeat[] = positions.map((position) => ({
      position,
      stackCbb: 10000,
      isHero: position === "CO",
      hasFolded: false,
      isButton: position === "BTN",
      isStraddle: false,
    }));
    render(<PokerTable seats={seats} potCbb={150} center={<p>board here</p>} />);
    expect(screen.getByRole("group", { name: "Table, 9 seats, pot 1.5bb" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^seat-/)).toHaveLength(9);
    expect(screen.getByText("board here")).toBeInTheDocument();
  });

  it("R3.13 renders an error state for a seat count outside 6 to 9", () => {
    const { rerender } = render(<PokerTable seats={sixSeats().slice(0, 5)} potCbb={150} />);
    expect(screen.getByRole("alert")).toHaveTextContent("A table needs 6 to 9 seats; got 5.");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    const ten = [...sixSeats(), ...sixSeats().slice(0, 4)];
    rerender(<PokerTable seats={ten} potCbb={150} />);
    expect(screen.getByRole("alert")).toHaveTextContent("got 10");
  });

  it("R3.13 seatLayout puts the first seat at the bottom when no seat is the hero", () => {
    const layout = seatLayout(7, -1);
    expect(layout[0]?.leftPercent).toBeCloseTo(50);
    expect(layout[0]?.topPercent).toBeGreaterThan(80);
  });

  it("R3.13 seatLayout puts the hero at the bottom center and every seat on the oval", () => {
    const layout = seatLayout(6, 3);
    expect(layout).toHaveLength(6);
    expect(layout[3]?.leftPercent).toBeCloseTo(50);
    expect(layout[3]?.topPercent).toBeGreaterThan(80);
    for (const spot of layout) {
      expect(spot.leftPercent).toBeGreaterThanOrEqual(0);
      expect(spot.leftPercent).toBeLessThanOrEqual(100);
    }
  });
});
