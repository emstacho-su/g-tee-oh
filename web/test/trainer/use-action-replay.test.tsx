/**
 * Tests for useActionReplay, the hook that plays opponent actions on the table one step at a time
 * (S38, R3.13, O-381 to O-383, PM note b): step order and timing on fake timers, the speed scale,
 * reduced motion showing the end at once with no timers, skip() and the action keys finishing the
 * replay instantly, the same state version never replaying, and a continuing hand replaying only
 * the entries added since the last prompt.
 */
import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainerPrompt } from "../../src/contracts.js";
import { fixturePrompt } from "../../src/fixtures/index.js";
import { useActionReplay, type ActionReplay, type ReplayOptions } from "../../src/trainer/use-action-replay.js";

type Entry = TrainerPrompt["history"][number];

const LINE: Entry[] = [
  { position: "UTG", token: "f", label: "Fold" },
  { position: "HJ", token: "r250", label: "Raise 2.5bb" },
  { position: "CO", token: "f", label: "Fold" },
];
const FIRST: TrainerPrompt = { ...fixturePrompt, hand_no: 3, state_version: 10, history: LINE };

function renderReplay(prompt: TrainerPrompt | null, options: ReplayOptions = { reducedMotion: false }) {
  return renderHook(({ current, opts }: { current: TrainerPrompt | null; opts: ReplayOptions }) => useActionReplay(current, opts), {
    initialProps: { current: prompt, opts: options },
  });
}

/** Runs the replay to its end, one step per act: each next timer starts after React renders. */
function playToEnd(result: { current: ActionReplay }): void {
  for (let guard = 0; guard < 20 && result.current.replaying; guard += 1) {
    act(() => void vi.advanceTimersByTime(result.current.stepMs ?? 0));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("R3.13 useActionReplay", () => {
  it("R3.13 plays one step at a time: fold 200 ms, raise 500 ms, then Your turn", () => {
    const { result } = renderReplay(FIRST);
    expect(result.current.replaying).toBe(true);
    expect(result.current.shown).toBe(1);
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.stepMs).toBe(200);
    act(() => void vi.advanceTimersByTime(199));
    expect(result.current.shown).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.shown).toBe(2);
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.stepMs).toBe(500);
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.shown).toBe(3);
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current.replaying).toBe(false);
    expect(result.current.activeIndex).toBeNull();
    expect(result.current.log.map((line) => line.text)).toEqual(["UTG: Fold", "HJ: Raise 2.5bb", "CO: Fold", "Your turn"]);
  });

  it("R3.13 fast speed halves every step", () => {
    const { result } = renderReplay(FIRST, { speed: "fast", reducedMotion: false });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current.shown).toBe(2);
    act(() => void vi.advanceTimersByTime(250));
    expect(result.current.shown).toBe(3);
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current.replaying).toBe(false);
  });

  it("R3.13 reduced motion shows the end state at once and starts no timer", () => {
    const { result } = renderReplay(FIRST, { reducedMotion: true });
    expect(result.current.replaying).toBe(false);
    expect(result.current.shown).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.log.at(-1)?.text).toBe("Your turn");
  });

  it("R3.13 skip() finishes the replay instantly and clears its timer (PM note b)", () => {
    const { result } = renderReplay(FIRST);
    act(() => result.current.skip());
    expect(result.current.replaying).toBe(false);
    expect(result.current.shown).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("R3.13 an action key (1 to 9) finishes the replay instantly; other keys do not (PM note b)", () => {
    const { result } = renderReplay(FIRST);
    act(() => void fireEvent.keyDown(window, { key: "a" }));
    expect(result.current.replaying).toBe(true);
    act(() => void fireEvent.keyDown(window, { key: "1" }));
    expect(result.current.replaying).toBe(false);
    expect(result.current.shown).toBe(3);
  });

  it("R3.13 the same session and state version never replays again", () => {
    const { result, rerender } = renderReplay(FIRST);
    playToEnd(result);
    expect(result.current.replaying).toBe(false);
    rerender({ current: { ...FIRST }, opts: { reducedMotion: false } });
    expect(result.current.replaying).toBe(false);
    expect(result.current.shown).toBe(3);
  });

  it("R3.13 a continuing hand replays only the new entries, the earlier ones stay shown", () => {
    const { result, rerender } = renderReplay(FIRST);
    playToEnd(result);
    const next: TrainerPrompt = {
      ...FIRST,
      state_version: 11,
      history: [...LINE, { position: "BTN", token: "c", label: "Call" }, { position: "SB", token: "f", label: "Fold" }],
    };
    rerender({ current: next, opts: { reducedMotion: false } });
    expect(result.current.replaying).toBe(true);
    expect(result.current.shown).toBe(4);
    expect(result.current.activeIndex).toBe(3);
    playToEnd(result);
    expect(result.current.shown).toBe(5);
    expect(result.current.log.map((line) => line.text)).toEqual([
      "UTG: Fold",
      "HJ: Raise 2.5bb",
      "CO: Fold",
      "BTN: Call",
      "SB: Fold",
      "Your turn",
    ]);
  });

  it("R3.13 log keys are stable within a hand and differ across hands, so a reader hears only additions", () => {
    const { result, rerender } = renderReplay(FIRST, { reducedMotion: true });
    const firstKeys = result.current.log.slice(0, 3).map((line) => line.key);
    rerender({ current: { ...FIRST, state_version: 11, history: [...LINE, { position: "BTN", token: "c", label: "Call" }] }, opts: { reducedMotion: true } });
    expect(result.current.log.slice(0, 3).map((line) => line.key)).toEqual(firstKeys);
    rerender({ current: { ...FIRST, hand_no: 4, state_version: 12 }, opts: { reducedMotion: true } });
    expect(result.current.log[0]?.key).not.toBe(firstKeys[0]);
  });

  it("R3.13 no prompt is an idle replay", () => {
    const { result } = renderReplay(null);
    expect(result.current.replaying).toBe(false);
    expect(result.current.log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("R3.13 turning reduced motion on mid-replay finishes it", () => {
    const { result, rerender } = renderReplay(FIRST);
    rerender({ current: FIRST, opts: { reducedMotion: true } });
    expect(result.current.replaying).toBe(false);
    expect(result.current.shown).toBe(3);
  });
});
