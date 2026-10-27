/**
 * The hotkey registry (S24, A7 section 4 keyboard first, R3.13).
 *
 * Mechanism: a Zustand vanilla store holds the list of mounted bindings (key, description, scope
 * label, handler) in registration order, plus whether the shortcuts overlay is open. Every update
 * returns a new list, never a mutated one. Keys compare case-insensitively ("s" and "S" are the
 * same binding). Duplicate policy: the later binding for a key wins while it is mounted, and the
 * earlier one becomes active again when the later unregisters, so a dialog or a nested panel can
 * take over a key for as long as it is on screen. The "?" key is reserved for the overlay and an
 * empty key is meaningless, so registering either throws a RangeError.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

/** The key that opens the shortcuts overlay (shift and slash on a US layout). */
export const SHORTCUTS_KEY = "?";
export const SHORTCUTS_DESCRIPTION = "Show keyboard shortcuts";
export const GENERAL_SCOPE = "General";

export interface HotkeyBinding {
  /** The KeyboardEvent.key value, for example "1", "s" or "Enter". */
  readonly key: string;
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

/** Lower-cases single characters so letter keys match with or without shift. */
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

/** The binding that answers a key: the latest registered one with that key. */
export function findBinding(bindings: readonly RegisteredBinding[], key: string): RegisteredBinding | undefined {
  const wanted = normalizeKey(key);
  return bindings.findLast((binding) => normalizeKey(binding.key) === wanted);
}

/** The bindings that currently answer a key, one per key, in registration order of the winners. */
export function activeBindings(bindings: readonly RegisteredBinding[]): RegisteredBinding[] {
  return bindings.filter((binding) => findBinding(bindings, binding.key)?.id === binding.id);
}

/** The app-wide registry used when no HotkeyRoot store is given. */
export const defaultHotkeyStore: HotkeyStore = createHotkeyStore();
