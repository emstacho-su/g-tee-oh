/**
 * Enter and Space on a focused widget (S46, R3.30, PR #45 review round 2, findings 1 and 2): a
 * widget that handled its own key (the range matrix selects a cell and prevents the default) wins
 * over every hotkey and over the replay skip, and a disabled button that kept the focus is no
 * longer a control, so Enter still goes on. The events are real keydowns on the focused element,
 * bubbling through React's root to the window listeners, as in a browser.
 */
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RangeMatrix } from "../../src/components/range-matrix/RangeMatrix.js";
import { fixturePrompt, fixtureStudyNode } from "../../src/fixtures/index.js";
import { HotkeyRoot, createHotkeyStore, useHotkey } from "../../src/hotkeys/index.js";
import { useActionReplay } from "../../src/trainer/use-action-replay.js";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function NextProbe({ onNext }: { onNext: () => void }) {
  useHotkey({ key: "Enter", description: "Next hand", scope: "Session", handler: onNext });
  return null;
}

function matrixGroup(): HTMLElement {
  const group = screen.getAllByRole("group").find((element) => element.tabIndex === 0);
  if (group === undefined) throw new Error("the range matrix has no focusable group");
  return group;
}

describe("R3.30 a focused range matrix keeps Enter and Space (review round 2, finding 1)", () => {
  it("R3.30 Enter on the focused matrix selects a cell and never deals the next hand", () => {
    const onNext = vi.fn();
    const onSelectHand = vi.fn();
    render(
      <HotkeyRoot store={createHotkeyStore()}>
        <NextProbe onNext={onNext} />
        <RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} popOut={false} />
      </HotkeyRoot>,
    );
    const group = matrixGroup();
    group.focus();
    expect(document.activeElement).toBe(group);
    fireEvent.keyDown(group, { key: "Enter" });
    expect(onSelectHand).toHaveBeenCalledOnce();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("R3.30 Space on the focused matrix during a replay selects a cell and does not skip the replay", () => {
    const onSelectHand = vi.fn();
    render(<RangeMatrix node={fixtureStudyNode} mode="frequency" theme="light" onSelectHand={onSelectHand} popOut={false} />);
    const history = [
      { position: "UTG", token: "f", label: "Fold" },
      { position: "HJ", token: "r250", label: "Raise 2.5bb" },
    ] as const;
    const { result } = renderHook(() => useActionReplay({ ...fixturePrompt, hand_no: 7, state_version: 30, history: [...history] }, { reducedMotion: false }));
    expect(result.current.replaying).toBe(true);
    const group = matrixGroup();
    group.focus();
    fireEvent.keyDown(group, { key: " " });
    expect(onSelectHand).toHaveBeenCalledOnce();
    expect(result.current.replaying).toBe(true);
  });

  it("R3.30 any focused element with a tabindex of 0 or more keeps Enter, whatever its role", () => {
    const onNext = vi.fn();
    render(
      <HotkeyRoot store={createHotkeyStore()}>
        <NextProbe onNext={onNext} />
        <div data-testid="widget" tabIndex={0}>
          widget
        </div>
      </HotkeyRoot>,
    );
    const widget = screen.getByTestId("widget");
    widget.focus();
    fireEvent.keyDown(widget, { key: "Enter" });
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onNext).toHaveBeenCalledOnce();
  });
});

describe("R3.30 a disabled button that kept the focus is not a control (review round 2, finding 2)", () => {
  it("R3.30 Enter on a focused button that became disabled goes on to the next hand", () => {
    const onNext = vi.fn();
    const { rerender } = render(
      <HotkeyRoot store={createHotkeyStore()}>
        <NextProbe onNext={onNext} />
        <button type="button">Call</button>
      </HotkeyRoot>,
    );
    const call = screen.getByRole("button", { name: "Call" });
    call.focus();
    rerender(
      <HotkeyRoot store={createHotkeyStore()}>
        <NextProbe onNext={onNext} />
        <button type="button" disabled>
          Call
        </button>
      </HotkeyRoot>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Call" }), { key: "Enter" });
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("R3.30 an aria-disabled control is not a control either", () => {
    const onNext = vi.fn();
    render(
      <HotkeyRoot store={createHotkeyStore()}>
        <NextProbe onNext={onNext} />
        <div role="button" tabIndex={0} aria-disabled="true">
          Ask
        </div>
      </HotkeyRoot>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Ask" }), { key: "Enter" });
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("R3.30 Space on a disabled button that kept the focus skips the next replay", () => {
    render(
      <button type="button" disabled>
        Call
      </button>,
    );
    const history = [{ position: "UTG", token: "r250", label: "Raise 2.5bb" }] as const;
    const { result } = renderHook(() => useActionReplay({ ...fixturePrompt, hand_no: 8, state_version: 31, history: [...history] }, { reducedMotion: false }));
    expect(result.current.replaying).toBe(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Call" }), { key: " " });
    expect(result.current.replaying).toBe(false);
  });
});
