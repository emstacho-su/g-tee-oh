/**
 * Tests for PokerTable, the game-style table of seat cards around a felt tabletop (S24, S38, R3.13,
 * O-380 to O-383): naming, seat cards with stack, markers, last-action badges and the hero's cards,
 * both orientations' spots on every seat as custom properties for the container query, and action
 * chips at the bet spots.
 */
import { readFileSync } from "node:fs";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STYLES_PATH, contrastRatio, parseThemes } from "../../../scripts/check-contrast.mjs";

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

  it("R3.13 shows each seat card's position, stack and bet", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    const bigBlind = screen.getByTestId("seat-BB");
    expect(bigBlind).toHaveTextContent("BB");
    expect(bigBlind).toHaveTextContent("99bb");
    expect(bigBlind).toHaveTextContent("Bet 1bb");
    expect(screen.getByTestId("seat-UTG")).not.toHaveTextContent("Bet");
  });

  it("R3.13 marks the button, the hero as You and the hero's cards", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    const button = screen.getByTestId("seat-BTN");
    expect(within(button).getByText("D")).toBeInTheDocument();
    expect(within(button).getByText("Dealer button")).toBeInTheDocument();
    expect(within(button).getByText("You")).toBeInTheDocument();
    expect(button).toHaveAttribute("data-hero", "true");
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

  it("R3.13 accepts nine seats and renders a center slot on the felt", () => {
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
    expect(within(screen.getByTestId("table-felt")).getByText("board here")).toBeInTheDocument();
  });

  it("R3.13 renders an error state for a seat count outside 6 to 9", () => {
    const { rerender } = render(<PokerTable seats={sixSeats().slice(0, 5)} potCbb={150} />);
    expect(screen.getByRole("alert")).toHaveTextContent("A table needs 6 to 9 seats; got 5.");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    const ten = [...sixSeats(), ...sixSeats().slice(0, 4)];
    rerender(<PokerTable seats={ten} potCbb={150} />);
    expect(screen.getByRole("alert")).toHaveTextContent("got 10");
  });

  it("R3.13 every seat carries its landscape and portrait spots, so the table's own width picks the layout (O-380)", () => {
    render(<PokerTable seats={sixSeats()} potCbb={150} />);
    expect(screen.getByTestId("poker-table")).toHaveClass("poker-table");
    const landscape = seatLayout(6, 3, "landscape");
    const portrait = seatLayout(6, 3, "portrait");
    const hero = screen.getByTestId("seat-BTN");
    expect(hero.style.getPropertyValue("--land-x")).toBe(`${landscape[3]!.seat.leftPercent}%`);
    expect(hero.style.getPropertyValue("--land-y")).toBe(`${landscape[3]!.seat.topPercent}%`);
    expect(hero.style.getPropertyValue("--port-x")).toBe(`${portrait[3]!.seat.leftPercent}%`);
    expect(hero.style.getPropertyValue("--port-y")).toBe(`${portrait[3]!.seat.topPercent}%`);
    expect(hero.style.getPropertyValue("--land-w")).toBe(`${landscape[3]!.box.widthPercent}%`);
    expect(hero.style.getPropertyValue("--port-w")).toBe(`${portrait[3]!.box.widthPercent}%`);
  });

  it("R3.13 a seat's last action shows as a badge, and the acting seat is marked active", () => {
    const seats = sixSeats().map((seat) =>
      seat.position === "SB" ? { ...seat, lastAction: "Raise 3bb", active: true } : seat,
    );
    render(<PokerTable seats={seats} potCbb={150} />);
    const smallBlind = screen.getByTestId("seat-SB");
    expect(within(smallBlind).getByTestId("seat-action")).toHaveTextContent("Raise 3bb");
    expect(smallBlind).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("seat-BB")).toHaveAttribute("data-active", "false");
  });

  it("R3.13 O-432 the hero ring and the active-seat ring never share a colour, and an acting hero shows only the active ring", () => {
    const seats = sixSeats().map((seat) => (seat.position === "SB" ? { ...seat, active: true } : seat));
    const { unmount } = render(<PokerTable seats={seats} potCbb={150} />);
    const hero = screen.getByTestId(`seat-${fixturePrompt.hero_position}`).className.split(" ");
    const acting = screen.getByTestId("seat-SB").className.split(" ");
    expect(hero).toContain("ring-accent");
    expect(hero).not.toContain("ring-focus");
    expect(acting).toContain("ring-focus");
    expect(acting).not.toContain("ring-accent");
    unmount();
    // The hero is the acting seat: one ring only (two ring colours on one element would race on CSS order).
    const heroActs = sixSeats().map((seat) => (seat.isHero ? { ...seat, active: true } : seat));
    render(<PokerTable seats={heroActs} potCbb={150} />);
    const both = screen.getByTestId(`seat-${fixturePrompt.hero_position}`).className.split(" ");
    expect(both).toContain("ring-focus");
    expect(both).not.toContain("ring-accent");
    expect(both).toContain("border-accent");
  });

  it("R3.13 O-432 in dark the active ring is the neutral focus and the hero ring the red accent, apart in hue and in lightness", () => {
    const { dark } = parseThemes(readFileSync(STYLES_PATH, "utf8"));
    const focus = dark.get("focus")?.value ?? "";
    const accent = dark.get("accent")?.value ?? "";
    // A neutral: the three channels are equal.
    expect(new Set([focus.slice(1, 3), focus.slice(3, 5), focus.slice(5, 7)]).size).toBe(1);
    expect(focus).not.toBe(accent);
    // Apart in lightness too, so the two rings differ in grayscale (2.55:1 for #ececec on #e0766c).
    expect(contrastRatio(focus, accent)).toBeGreaterThanOrEqual(2.5);
  });

  it("R3.13 an action chip sits at the seat's bet spot with the api label, and a moving chip slides there (O-381)", () => {
    const seats = sixSeats().map((seat) => {
      if (seat.position === "SB") return { ...seat, chip: { label: "Raise 3bb", moving: true, durationMs: 500 } };
      if (seat.position === "BB") return { ...seat, chip: { label: "Call", moving: false, durationMs: 0 } };
      return seat;
    });
    render(<PokerTable seats={seats} potCbb={150} />);
    const moving = screen.getByTestId("chip-SB");
    expect(moving).toHaveTextContent("Raise 3bb");
    expect(moving).toHaveAttribute("data-moving", "true");
    expect(moving.style.getPropertyValue("--chip-ms")).toBe("500ms");
    const landscape = seatLayout(6, 3, "landscape");
    expect(moving.style.getPropertyValue("--land-bet-x")).toBe(`${landscape[4]!.bet.leftPercent}%`);
    expect(moving.style.getPropertyValue("--land-x")).toBe(`${landscape[4]!.seat.leftPercent}%`);
    expect(screen.getByTestId("chip-BB")).toHaveAttribute("data-moving", "false");
    expect(screen.queryByTestId("chip-UTG")).not.toBeInTheDocument();
    // Chips are decoration: the seat badge and the log carry the words.
    expect(moving).toHaveAttribute("aria-hidden", "true");
  });
});
