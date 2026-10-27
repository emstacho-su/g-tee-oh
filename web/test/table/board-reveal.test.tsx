/** Tests for BoardReveal, the flop, turn and river slots with a reveal per new card (S24, R3.13). */
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardReveal, usePrefersReducedMotion } from "../../src/components/table/index.js";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  if (originalMatchMedia !== undefined) Object.defineProperty(window, "matchMedia", originalMatchMedia);
});

describe("R3.13 usePrefersReducedMotion", () => {
  it("R3.13 follows changes to the media query", () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => {
        listener = callback;
      },
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => listener?.({ matches: true } as MediaQueryListEvent));
    expect(result.current).toBe(true);
  });

  it("R3.13 treats a browser without matchMedia as allowing motion", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: undefined });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe("R3.13 BoardReveal", () => {
  it("R3.13 an empty board shows three empty street slots", () => {
    render(<BoardReveal cards={[]} />);
    const board = screen.getByTestId("board-reveal");
    expect(board).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Flop" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Turn" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "River" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /not dealt/ })).toHaveLength(5);
  });

  it("R3.13 shows dealt cards in their street slots", () => {
    render(<BoardReveal cards={["Ah", "Kd", "7c", "2s"]} />);
    expect(screen.getByRole("group", { name: "Flop" })).toHaveTextContent("A♥K♦7♣");
    expect(screen.getByRole("img", { name: "Two of spades" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "River not dealt" })).toBeInTheDocument();
  });

  it("R3.13 animates and announces newly revealed cards, street by street", () => {
    mockReducedMotion(false);
    const { rerender } = render(<BoardReveal cards={[]} />);
    const live = screen.getByTestId("board-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();

    rerender(<BoardReveal cards={["Ah", "Kd", "7c"]} />);
    expect(live).toHaveTextContent("Flop: Ace of hearts, King of diamonds, Seven of clubs");
    expect(screen.getByTestId("board-card-0")).toHaveAttribute("data-reveal", "animate");

    rerender(<BoardReveal cards={["Ah", "Kd", "7c", "2s"]} />);
    expect(live).toHaveTextContent("Turn: Two of spades");
    expect(screen.getByTestId("board-card-0")).toHaveAttribute("data-reveal", "shown");
    expect(screen.getByTestId("board-card-3")).toHaveAttribute("data-reveal", "animate");

    rerender(<BoardReveal cards={["Ah", "Kd", "7c", "2s", "Qh"]} />);
    expect(live).toHaveTextContent("River: Queen of hearts");
  });

  it("R3.13 skips the animation under prefers-reduced-motion but still announces", () => {
    mockReducedMotion(true);
    const { rerender } = render(<BoardReveal cards={[]} />);
    rerender(<BoardReveal cards={["Ah", "Kd", "7c"]} />);
    expect(screen.getByTestId("board-card-0")).toHaveAttribute("data-reveal", "instant");
    expect(screen.getByTestId("board-announcement")).toHaveTextContent("Flop:");
  });

  it("R3.13 a first render or a new hand's board is shown without animation or announcement", () => {
    mockReducedMotion(false);
    const { rerender } = render(<BoardReveal cards={["Ah", "Kd", "7c"]} />);
    expect(screen.getByTestId("board-card-0")).toHaveAttribute("data-reveal", "shown");
    expect(screen.getByTestId("board-announcement")).toBeEmptyDOMElement();
    rerender(<BoardReveal cards={["2h", "3d", "4c"]} />);
    expect(screen.getByTestId("board-card-0")).toHaveAttribute("data-reveal", "shown");
    expect(screen.getByTestId("board-announcement")).toBeEmptyDOMElement();
  });

  it("R3.13 a jump of more than one street is announced as the board", () => {
    const { rerender } = render(<BoardReveal cards={[]} />);
    rerender(<BoardReveal cards={["Ah", "Kd", "7c", "2s"]} />);
    expect(screen.getByTestId("board-announcement")).toHaveTextContent(
      "Board: Ace of hearts, King of diamonds, Seven of clubs, Two of spades",
    );
  });

  it("R3.13 rejects a card count other than 0, 3, 4 or 5", () => {
    render(<BoardReveal cards={["Ah", "Kd"]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("A board holds 0, 3, 4 or 5 cards; got 2.");
  });
});
