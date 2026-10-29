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
  displayBinding,
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

/** A binding that needs Shift held (S46, R3.30, O-474). */
function ShiftProbe({ hotkey, description, scope = "Test", enabled = true, onPress }: ProbeProps) {
  useHotkey({ key: hotkey, shift: true, description, scope, handler: onPress }, enabled);
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

  it("R3.30 a shift binding answers only with Shift held, and a plain binding never answers with Shift held (O-474)", () => {
    const plain = vi.fn();
    const chord = vi.fn();
    renderWithRoot(
      <>
        <Probe hotkey="e" description="Plain" onPress={plain} />
        <ShiftProbe hotkey="e" description="Chord" onPress={chord} />
      </>,
    );
    fireEvent.keyDown(window, { key: "E", shiftKey: true });
    expect(chord).toHaveBeenCalledOnce();
    expect(plain).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "e" });
    expect(plain).toHaveBeenCalledOnce();
    expect(chord).toHaveBeenCalledOnce();
  });

  it("R3.30 a plain binding and its shift chord are two bindings, both active", () => {
    const store = createHotkeyStore();
    store.getState().register({ key: "e", description: "Plain", scope: "S", handler: vi.fn() });
    store.getState().register({ key: "e", shift: true, description: "Chord", scope: "S", handler: vi.fn() });
    expect(findBinding(store.getState().bindings, "e")?.description).toBe("Plain");
    expect(findBinding(store.getState().bindings, "E", true)?.description).toBe("Chord");
    expect(activeBindings(store.getState().bindings).map((binding) => binding.description)).toEqual(["Plain", "Chord"]);
  });

  it("R3.30 Enter and Space on any focused control are left to it; on the page or plain text they reach the binding (PR #45 review round 1, finding 2)", () => {
    const onEnter = vi.fn();
    const onSpace = vi.fn();
    renderWithRoot(
      <>
        <Probe hotkey="Enter" description="Next" onPress={onEnter} />
        <Probe hotkey=" " description="Skip" onPress={onSpace} />
        <button type="button" aria-expanded="false">
          section
        </button>
        <button type="button">End session</button>
        <a href="#x">link</a>
        <div role="tab" tabIndex={0}>
          tab
        </div>
        <div role="menuitem" tabIndex={0}>
          item
        </div>
        <p data-testid="text">text</p>
      </>,
    );
    for (const control of [
      screen.getByRole("button", { name: "section" }),
      screen.getByRole("button", { name: "End session" }),
      screen.getByRole("link", { name: "link" }),
      screen.getByRole("tab", { name: "tab" }),
      screen.getByRole("menuitem", { name: "item" }),
    ]) {
      fireEvent.keyDown(control, { key: "Enter" });
      fireEvent.keyDown(control, { key: " " });
    }
    expect(onEnter).not.toHaveBeenCalled();
    expect(onSpace).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("text"), { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(window, { key: " " });
    expect(onEnter).toHaveBeenCalledTimes(2);
    expect(onSpace).toHaveBeenCalledOnce();
  });

  it("R3.16 a binding that asks for it still answers Enter from a focused control (the quiz's submit after choosing an option)", () => {
    const onSubmit = vi.fn();
    function Submit() {
      useHotkey({ key: "Enter", fromControls: true, description: "Submit", scope: "Quiz", handler: onSubmit });
      return null;
    }
    renderWithRoot(
      <>
        <Submit />
        <button type="button" aria-pressed="true">
          option
        </button>
      </>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "option" }), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("R3.30 a plain digit or symbol binding answers with Shift held (AZERTY digits), a plain letter does not (PR #45 review round 1, finding 6)", () => {
    const store = createHotkeyStore();
    store.getState().register({ key: "1", description: "Size 1", scope: "S", handler: vi.fn() });
    store.getState().register({ key: "e", description: "Plain e", scope: "S", handler: vi.fn() });
    expect(findBinding(store.getState().bindings, "1", true)?.description).toBe("Size 1");
    expect(findBinding(store.getState().bindings, "1", false)?.description).toBe("Size 1");
    expect(findBinding(store.getState().bindings, "E", true)).toBeUndefined();
    expect(findBinding(store.getState().bindings, "e", false)?.description).toBe("Plain e");
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

  it("R3.30 lists the reserved keys under their scope with no handler behind them", async () => {
    renderWithRoot(<Probe hotkey="n" description="Next hand" scope="Session" onPress={vi.fn()} />);
    await userEvent.keyboard("?");
    const overlay = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).getByTestId("shortcuts-overlay");
    const session = within(overlay).getByRole("region", { name: "Session" });
    expect(within(session).getByText("R")).toBeInTheDocument();
    expect(within(session).getByText(/Repeat hand/)).toHaveTextContent("reserved");
  });

  it("R3.30 prints a shift binding as Shift+ the keycap", async () => {
    renderWithRoot(<ShiftProbe hotkey="e" description="End session" scope="Session" onPress={vi.fn()} />);
    await userEvent.keyboard("?");
    const overlay = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).getByTestId("shortcuts-overlay");
    expect(within(overlay).getByText("Shift+E")).toBeInTheDocument();
    expect(displayBinding({ key: "e", shift: true })).toBe("Shift+E");
    expect(displayBinding({ key: "Enter" })).toBe("Enter");
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

describe("R3.30 PR #45 review round 2, finding 6: reserved keys only beside their scope's live keys", () => {
  it("R3.30 a page with no session keys shows no Session group, only General", async () => {
    renderWithRoot(<Probe hotkey="b" description="Brush" scope="Painter" onPress={vi.fn()} />);
    await userEvent.keyboard("?");
    const overlay = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).getByTestId("shortcuts-overlay");
    expect(within(overlay).queryByRole("region", { name: "Session" })).not.toBeInTheDocument();
    expect(within(overlay).queryByText(/Repeat hand/)).not.toBeInTheDocument();
    expect(within(overlay).getByRole("region", { name: "Painter" })).toBeInTheDocument();
  });
});
