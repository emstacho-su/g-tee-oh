/**
 * Tests for SpotTable with the opponent-action replay (S38, R3.13, O-381 to O-383, PM note b): the
 * table replays the dealt line on its own when the page passes no replay, a click on the table
 * finishes it instantly, the seats show the shown actions as badges and chips, and the hidden log
 * reads each action; a page that owns the replay passes it in and SpotTable only draws it.
 */
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixturePlainPrompt } from "../../src/fixtures/trainer.js";
import { SpotTable } from "../../src/routes/drill-run/SpotTable.js";
import { useActionReplay } from "../../src/trainer/use-action-replay.js";

const PROMPT: TrainerPrompt = {
  ...fixturePlainPrompt,
  synthetic: false,
  history: [
    { position: "UTG", token: "f", label: "Fold" },
    { position: "HJ", token: "r250", label: "Raise 2.5bb" },
    { position: "CO", token: "f", label: "Fold" },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("R3.13 SpotTable replay", () => {
  it("R3.13 replays the dealt line by itself: the first fold shows at once, the raise after 200 ms", () => {
    render(<SpotTable prompt={PROMPT} />);
    const log = screen.getByRole("log", { name: "Action this hand" });
    expect(log).toHaveTextContent("UTG: Fold");
    expect(log).not.toHaveTextContent("HJ: Raise 2.5bb");
    expect(screen.getByTestId("seat-UTG")).toHaveAttribute("data-active", "true");
    act(() => void vi.advanceTimersByTime(200));
    expect(log).toHaveTextContent("HJ: Raise 2.5bb");
    expect(within(screen.getByTestId("seat-HJ")).getByTestId("seat-action")).toHaveTextContent("Raise 2.5bb");
    expect(screen.getByTestId("chip-HJ")).toHaveAttribute("data-moving", "true");
    expect(screen.getByTestId("seat-CO")).toHaveAttribute("data-folded", "false");
  });

  it("R3.13 a click on the table finishes the replay instantly (PM note b)", () => {
    render(<SpotTable prompt={PROMPT} />);
    fireEvent.click(screen.getByTestId("poker-table"));
    const log = screen.getByRole("log", { name: "Action this hand" });
    expect(log).toHaveTextContent("CO: Fold");
    expect(log).toHaveTextContent("Your turn");
    expect(screen.getByTestId("seat-CO")).toHaveAttribute("data-folded", "true");
    expect(screen.getByTestId("chip-HJ")).toHaveAttribute("data-moving", "false");
    expect(screen.getByTestId("poker-table")).toHaveAttribute("data-replaying", "false");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("R3.13 a page that owns the replay passes it in, and SpotTable draws that state", () => {
    const { result } = renderHook(() => useActionReplay(PROMPT, { reducedMotion: false }));
    render(<SpotTable prompt={PROMPT} replay={result.current} />);
    expect(screen.getByTestId("poker-table")).toHaveAttribute("data-replaying", "true");
    act(() => result.current.skip());
  });
});
