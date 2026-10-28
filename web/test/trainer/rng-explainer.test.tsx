/**
 * Tests for the Mixed-frequency mode explainer and its open state (S25, S37, R3.10, 05 section 7,
 * ADR 0024, O-283, O-285, O-344). The dialog content is pinned by a snapshot, rewritten for the
 * new methodology (screen review row 20); the hook's first-use memory runs against an injected
 * storage, including one that throws.
 */
import { act, render, renderHook, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { RngExplainer, useRngExplainer } from "../../src/components/trainer/index.js";
import {
  EXPLAINER_SEEN_VALUE,
  RNG_EXPLAINER_SEEN_KEY,
  readExplainerSeen,
  rememberExplainerSeen,
  type ExplainerStorage,
} from "../../src/components/trainer/rng-explainer-memory.js";
import { HotkeyRoot, createHotkeyStore, type HotkeyStore } from "../../src/hotkeys/index.js";

function memoryStorage(initial: Readonly<Record<string, string>> = {}): ExplainerStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function throwingStorage(): ExplainerStorage {
  return {
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
}

function hotkeyWrapper(store: HotkeyStore = createHotkeyStore()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <HotkeyRoot store={store}>{children}</HotkeyRoot>;
  };
}

describe("R3.10 RngExplainer", () => {
  it("R3.10 the explainer's content matches its snapshot: what earns Best, how the roll works, why practise mixing (ADR 0024)", () => {
    render(<RngExplainer open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("rng-explainer-content")).toMatchSnapshot();
  });

  it("R3.10 is a dialog named How Mixed-frequency mode works with the three parts as headings", () => {
    render(<RngExplainer open onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "How Mixed-frequency mode works" });
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "What earns Best",
      "How the roll works",
      "Why practise mixing",
    ]);
    expect(dialog).toHaveTextContent("rolls 1 to 40 call and 41 to 100 raise");
    expect(dialog).toHaveTextContent("Best is always the action with the highest EV");
    expect(dialog).toHaveTextContent("never changes your grade");
    expect(dialog).not.toHaveTextContent("That action is labeled Best");
  });

  it("R3.10 draws the example on the same scale, first hidden then revealed, with no dead info button inside the dialog (ADR 0024 rule 3)", () => {
    render(<RngExplainer open onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const [before, after] = within(dialog).getAllByTestId("rng-roller");
    expect(before).toHaveAttribute("data-revealed", "false");
    expect(before).toHaveTextContent("Roll 37");
    expect(after).toHaveAttribute("data-revealed", "true");
    const bands = within(after as HTMLElement).getAllByRole("listitem").filter((item) => item.hasAttribute("data-range"));
    expect(bands.map((band) => band.getAttribute("data-range"))).toEqual(["1-40", "41-100"]);
    expect(after).toHaveTextContent("Roll 37 fell on Call");
    expect(within(dialog).queryByRole("button", { name: "How Mixed-frequency mode works" })).not.toBeInTheDocument();
  });

  it("R3.10 renders nothing while closed and reports a close through onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<RngExplainer open={false} onOpenChange={onOpenChange} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<RngExplainer open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("R3.10 rng-explainer-memory", () => {
  it("R3.10 reads unseen, then seen once remembered", () => {
    const storage = memoryStorage();
    expect(readExplainerSeen(() => storage)).toBe("unseen");
    expect(rememberExplainerSeen(() => storage)).toBe(true);
    expect(storage.values.get(RNG_EXPLAINER_SEEN_KEY)).toBe(EXPLAINER_SEEN_VALUE);
    expect(readExplainerSeen(() => storage)).toBe("seen");
  });

  it("R3.10 a missing or throwing storage reads as unavailable and never throws", () => {
    expect(readExplainerSeen(() => null)).toBe("unavailable");
    expect(rememberExplainerSeen(() => null)).toBe(false);
    expect(readExplainerSeen(throwingStorage)).toBe("unavailable");
    expect(rememberExplainerSeen(throwingStorage)).toBe(false);
    const accessorThrows = () => {
      throw new DOMException("denied", "SecurityError");
    };
    expect(readExplainerSeen(accessorThrows)).toBe("unavailable");
    expect(rememberExplainerSeen(accessorThrows)).toBe(false);
  });

  it("R3.10 the default storage is window.localStorage, read lazily", () => {
    window.localStorage.removeItem(RNG_EXPLAINER_SEEN_KEY);
    expect(readExplainerSeen()).toBe("unseen");
    expect(rememberExplainerSeen()).toBe(true);
    expect(readExplainerSeen()).toBe("seen");
    window.localStorage.removeItem(RNG_EXPLAINER_SEEN_KEY);
  });

  it("R3.10 an unexpected error that is not a storage failure propagates", () => {
    const broken = () => {
      throw new TypeError("a bug, not a blocked storage");
    };
    expect(() => readExplainerSeen(broken)).toThrow(TypeError);
  });
});

describe("R3.10 useRngExplainer", () => {
  it("R3.10 starts closed and setOpen opens and closes it", () => {
    const { result } = renderHook(() => useRngExplainer({ storage: () => memoryStorage() }), { wrapper: hotkeyWrapper() });
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
  });

  it("R3.10 first use opens it once and remembers it; a second call does not reopen", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useRngExplainer({ storage: () => storage }), { wrapper: hotkeyWrapper() });
    act(() => result.current.showIfFirstUse());
    expect(result.current.open).toBe(true);
    expect(storage.values.get(RNG_EXPLAINER_SEEN_KEY)).toBe(EXPLAINER_SEEN_VALUE);
    act(() => result.current.setOpen(false));
    act(() => result.current.showIfFirstUse());
    expect(result.current.open).toBe(false);
  });

  it("R3.10 a browser that has seen it does not open it again in a later mount", () => {
    const storage = memoryStorage({ [RNG_EXPLAINER_SEEN_KEY]: EXPLAINER_SEEN_VALUE });
    const { result } = renderHook(() => useRngExplainer({ storage: () => storage }), { wrapper: hotkeyWrapper() });
    act(() => result.current.showIfFirstUse());
    expect(result.current.open).toBe(false);
  });

  it("R3.10 a storage failure still opens it, does not throw, and opens it again on the next mount", () => {
    const first = renderHook(() => useRngExplainer({ storage: throwingStorage }), { wrapper: hotkeyWrapper() });
    expect(() => act(() => first.result.current.showIfFirstUse())).not.toThrow();
    expect(first.result.current.open).toBe(true);
    first.unmount();
    const second = renderHook(() => useRngExplainer({ storage: throwingStorage }), { wrapper: hotkeyWrapper() });
    act(() => second.result.current.showIfFirstUse());
    expect(second.result.current.open).toBe(true);
  });

  it("R3.10 within one mount a failing storage shows it only once, so it never nags on every prompt", () => {
    const { result } = renderHook(() => useRngExplainer({ storage: throwingStorage }), { wrapper: hotkeyWrapper() });
    act(() => result.current.showIfFirstUse());
    act(() => result.current.setOpen(false));
    act(() => result.current.showIfFirstUse());
    expect(result.current.open).toBe(false);
  });

  it("R3.10 the I key opens it and the shortcuts overlay lists it under RNG mode (O-285)", async () => {
    const store = createHotkeyStore();
    const { result } = renderHook(() => useRngExplainer({ storage: () => memoryStorage() }), { wrapper: hotkeyWrapper(store) });
    expect(store.getState().bindings.map(({ key, scope, description }) => ({ key, scope, description }))).toEqual([
      { key: "i", scope: "Mixed-frequency mode", description: "How Mixed-frequency mode works" },
    ]);
    await userEvent.keyboard("i");
    expect(result.current.open).toBe(true);
  });

  it("R3.10 hotkey false registers no I key", async () => {
    const store = createHotkeyStore();
    const { result } = renderHook(() => useRngExplainer({ hotkey: false, storage: () => memoryStorage() }), {
      wrapper: hotkeyWrapper(store),
    });
    expect(store.getState().bindings).toHaveLength(0);
    await userEvent.keyboard("i");
    expect(result.current.open).toBe(false);
  });
});
