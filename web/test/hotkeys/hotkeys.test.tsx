/**
 * Tests for the keyboard-first hotkey system (S24, A7 section 4, R3.13): the Zustand registry,
 * useHotkey, the one window listener in HotkeyRoot and the "?" shortcuts overlay.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  HotkeyRoot,
  SHORTCUTS_KEY,
  activeBindings,
  createHotkeyStore,
  findBinding,
  handleKeydown,
  useHotkey,
  type HotkeyStore,
} from "../../src/hotkeys/index.js";

interface ProbeProps {
  hotkey: string;
  description: string;
  scope?: string;
  enabled?: boolean;
  onPress: () => void;
}

function Probe({ hotkey, description, scope = "Test", enabled = true, onPress }: ProbeProps) {
  useHotkey({ key: hotkey, description, scope, handler: onPress }, enabled);
  return null;
}

function renderWithRoot(ui: ReactNode, store: HotkeyStore = createHotkeyStore()) {
  const view = render(<HotkeyRoot store={store}>{ui}</HotkeyRoot>);
  return { ...view, store };
}

describe("R3.13 hotkey registry", () => {
  it("R3.13 registers and unregisters bindings immutably", () => {
    const store = createHotkeyStore();
    const before = store.getState().bindings;
    const id = store.getState().register({ key: "a", description: "Do a", scope: "S", handler: vi.fn() });
    expect(store.getState().bindings).toHaveLength(1);
    expect(before).toHaveLength(0);
    store.getState().unregister(id);
    expect(store.getState().bindings).toHaveLength(0);
  });

  it("R3.13 rejects the reserved ? key and an empty key", () => {
    const store = createHotkeyStore();
    expect(() => store.getState().register({ key: SHORTCUTS_KEY, description: "x", scope: "S", handler: vi.fn() })).toThrow(
      RangeError,
    );
    expect(() => store.getState().register({ key: "", description: "x", scope: "S", handler: vi.fn() })).toThrow(RangeError);
  });

  it("R3.13 the later binding for a key wins and the earlier returns when it unregisters", () => {
    const store = createHotkeyStore();
    const first = vi.fn();
    const second = vi.fn();
    store.getState().register({ key: "s", description: "First", scope: "S", handler: first });
    const secondId = store.getState().register({ key: "S", description: "Second", scope: "S", handler: second });
    expect(findBinding(store.getState().bindings, "s")?.description).toBe("Second");
    expect(activeBindings(store.getState().bindings).map((binding) => binding.description)).toEqual(["Second"]);
    store.getState().unregister(secondId);
    expect(findBinding(store.getState().bindings, "S")?.description).toBe("First");
  });
});

describe("R3.13 useHotkey and HotkeyRoot", () => {
  it("R3.13 dispatches a pressed key to its binding", async () => {
    const onPress = vi.fn();
    renderWithRoot(<Probe hotkey="1" description="Choose fold" onPress={onPress} />);
    await userEvent.keyboard("1");
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("R3.13 matches letters case-insensitively", async () => {
    const onPress = vi.fn();
    renderWithRoot(<Probe hotkey="u" description="Unsure" onPress={onPress} />);
    await userEvent.keyboard("U");
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("R3.13 unregisters on unmount and when disabled", async () => {
    const onPress = vi.fn();
    function Toggle() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>
            hide
          </button>
          {shown ? <Probe hotkey="2" description="Two" onPress={onPress} /> : null}
        </>
      );
    }
    const { store } = renderWithRoot(
      <>
        <Toggle />
        <Probe hotkey="3" description="Three" enabled={false} onPress={onPress} />
      </>,
    );
    expect(store.getState().bindings.map((binding) => binding.key)).toEqual(["2"]);
    await userEvent.click(screen.getByRole("button", { name: "hide" }));
    expect(store.getState().bindings).toHaveLength(0);
    await userEvent.keyboard("23");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("R3.13 calls the latest handler without re-registering", async () => {
    const calls: string[] = [];
    function Counter() {
      const [count, setCount] = useState(0);
      useHotkey({ key: "c", description: "Count", scope: "Test", handler: () => calls.push(`count ${count}`) });
      return (
        <button type="button" onClick={() => setCount(count + 1)}>
          inc
        </button>
      );
    }
    renderWithRoot(<Counter />);
    await userEvent.click(screen.getByRole("button", { name: "inc" }));
    await userEvent.keyboard("c");
    expect(calls).toEqual(["count 1"]);
  });

  it("R3.13 ignores keys typed into inputs, textareas, selects and contenteditable", async () => {
    const onPress = vi.fn();
    renderWithRoot(
      <>
        <Probe hotkey="s" description="Sure" onPress={onPress} />
        <label>
          note
          <input />
        </label>
        <label>
          long
          <textarea />
        </label>
        <label>
          pick
          <select>
            <option>s</option>
          </select>
        </label>
        <div contentEditable data-testid="editable" suppressContentEditableWarning>
          <span data-testid="inner">text</span>
        </div>
      </>,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "note" }), "s");
    await userEvent.type(screen.getByRole("textbox", { name: "long" }), "s");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "pick" }), { key: "s" });
    fireEvent.keyDown(screen.getByTestId("inner"), { key: "s" });
    expect(onPress).not.toHaveBeenCalled();
  });

  it("R3.13 ignores keys with ctrl, alt or meta and auto-repeats", () => {
    const onPress = vi.fn();
    renderWithRoot(<Probe hotkey="s" description="Sure" onPress={onPress} />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "s", altKey: true });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.keyDown(window, { key: "s", repeat: true });
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "s" });
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("R3.13 handleKeydown reports whether it handled the key", () => {
    const store = createHotkeyStore();
    store.getState().register({ key: "x", description: "X", scope: "S", handler: vi.fn() });
    const handled = new KeyboardEvent("keydown", { key: "x", cancelable: true });
    expect(handleKeydown(store, handled)).toBe(true);
    expect(handled.defaultPrevented).toBe(true);
    expect(handleKeydown(store, new KeyboardEvent("keydown", { key: "q" }))).toBe(false);
  });

  it("R3.13 removes the window listener when HotkeyRoot unmounts", () => {
    const onPress = vi.fn();
    const { unmount } = renderWithRoot(<Probe hotkey="s" description="Sure" onPress={onPress} />);
    unmount();
    fireEvent.keyDown(window, { key: "s" });
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("R3.13 ShortcutsOverlay", () => {
  it("R3.13 opens on ? and lists active bindings grouped by scope, ? included", async () => {
    renderWithRoot(
      <>
        <Probe hotkey="1" description="Choose Fold" scope="Actions" onPress={vi.fn()} />
        <Probe hotkey="s" description="Sure" scope="Confidence" onPress={vi.fn()} />
      </>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const overlay = within(dialog).getByTestId("shortcuts-overlay");
    const actions = within(overlay).getByRole("region", { name: "Actions" });
    expect(within(actions).getByText("Choose Fold")).toBeInTheDocument();
    expect(within(actions).getByText("1")).toBeInTheDocument();
    const confidence = within(overlay).getByRole("region", { name: "Confidence" });
    expect(within(confidence).getByText("S")).toBeInTheDocument();
    const general = within(overlay).getByRole("region", { name: "General" });
    expect(within(general).getByText("?")).toBeInTheDocument();
    expect(within(general).getByText("Show keyboard shortcuts")).toBeInTheDocument();
  });

  it("R3.13 does not dispatch other hotkeys while open, and Escape closes it", async () => {
    const onPress = vi.fn();
    const { store } = renderWithRoot(<Probe hotkey="1" description="One" onPress={onPress} />);
    act(() => store.getState().setOverlayOpen(true));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    expect(onPress).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.getState().overlayOpen).toBe(false);
  });
});
