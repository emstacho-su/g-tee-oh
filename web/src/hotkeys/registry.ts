/**
 * The hotkey registry (S24, S46, A7 section 4 keyboard first, R3.13, R3.30, O-474).
 *
 * Mechanism: a Zustand vanilla store holds the list of mounted bindings (key, shift, description,
 * scope label, handler) in registration order, plus whether the shortcuts overlay is open. Every
 * update returns a new list, never a mutated one. Keys compare case-insensitively ("s" and "S" are
 * the same key). A binding may ask for Shift (shift: true): it answers only while Shift is held,
 * and a plain letter binding answers only while Shift is not held, so "E" and "Shift+E" are two
 * bindings (S46, O-474; before S46 a plain binding also answered with Shift held). A plain digit or
 * symbol binding still answers with Shift held, for layouts that need Shift to type a digit (PR #45
 * review round 1, finding 6). Duplicate policy: the later binding for a key and shift state wins while it is mounted, and the earlier
 * one becomes active again when the later unregisters, so a dialog or a nested panel can take
 * over a key for as long as it is on screen. The "?" key is reserved for the overlay and an empty
 * key is meaningless, so registering either throws a RangeError.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

/** The key that opens the shortcuts overlay (shift and slash on a US layout). */
export const SHORTCUTS_KEY = "?";
export const SHORTCUTS_DESCRIPTION = "Show keyboard shortcuts";
export const GENERAL_SCOPE = "General";

export interface HotkeyBinding {
  /** The KeyboardEvent.key value, for example "1", "s", " " or "Enter". */
  readonly key: string;
  /** True when the binding needs Shift held (a chord such as Shift+E); absent or false is the plain key. */
  readonly shift?: boolean;
  /**
   * True when the binding also answers Enter or Space while a control (button, link, field, tab,
   * menu item) has focus; by default a focused control keeps those keys (dispatch.ts). The quiz's
   * submit sets it, so Enter after choosing an option still submits (R3.16).
   */
  readonly fromControls?: boolean;
  readonly description: string;
  /** A label grouping bindings in the overlay, for example "Actions". */
  readonly scope: string;
  readonly handler: () => void;
}

export interface RegisteredBinding extends HotkeyBinding {
  readonly id: number;
}

export interface HotkeyState {
  readonly bindings: readonly RegisteredBinding[];
  readonly overlayOpen: boolean;
  /** Adds a binding and returns its id for unregister. */
  register: (binding: HotkeyBinding) => number;
  unregister: (id: number) => void;
  setOverlayOpen: (open: boolean) => void;
}

export type HotkeyStore = StoreApi<HotkeyState>;

/** Lower-cases single characters so letter keys match with or without caps lock. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function requireBindableKey(key: string): void {
  if (key === "") throw new RangeError("a hotkey needs a non-empty key");
  if (key === SHORTCUTS_KEY) throw new RangeError(`the ${SHORTCUTS_KEY} key is reserved for the shortcuts overlay`);
}

/** A fresh, empty registry. Tests and isolated trees create their own; the app uses one default. */
export function createHotkeyStore(): HotkeyStore {
  let nextId = 1;
  return createStore<HotkeyState>()((set) => ({
    bindings: [],
    overlayOpen: false,
    register: (binding) => {
      requireBindableKey(binding.key);
      const id = nextId;
      nextId += 1;
      set((state) => ({ bindings: [...state.bindings, { ...binding, id }] }));
      return id;
    },
    unregister: (id) => set((state) => ({ bindings: state.bindings.filter((binding) => binding.id !== id) })),
    setOverlayOpen: (open) => set({ overlayOpen: open }),
  }));
}

const LETTER = /^[a-z]$/i;

/**
 * Whether a binding answers this key in this shift state. A chord (shift: true) needs Shift held.
 * A plain letter binding answers only without Shift, since its Shift variant can be another
 * binding (E and Shift+E); a plain digit or symbol answers either way, since some layouts need
 * Shift to type a digit (AZERTY) and none has a second binding there (PR #45 review round 1, 6).
 */
export function bindingMatches(binding: HotkeyBinding, key: string, shift: boolean): boolean {
  if (normalizeKey(binding.key) !== normalizeKey(key)) return false;
  if (binding.shift === true) return shift;
  return !shift || !LETTER.test(binding.key);
}

/** The binding that answers a key: the latest registered one with that key and shift state. */
export function findBinding(bindings: readonly RegisteredBinding[], key: string, shift = false): RegisteredBinding | undefined {
  return bindings.findLast((binding) => bindingMatches(binding, key, shift));
}

/** The bindings that currently answer a key, one per key and shift state, in registration order of the winners. */
export function activeBindings(bindings: readonly RegisteredBinding[]): RegisteredBinding[] {
  return bindings.filter((binding) => findBinding(bindings, binding.key, binding.shift ?? false)?.id === binding.id);
}

/** The app-wide registry used when no HotkeyRoot store is given. */
export const defaultHotkeyStore: HotkeyStore = createHotkeyStore();
