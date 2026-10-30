/**
 * Keydown dispatch for the hotkey registry (S24, A7 section 4, R3.13).
 *
 * Mechanism: HotkeyRoot installs one window keydown listener that calls handleKeydown. A key is
 * ignored when it carries ctrl, alt or meta (browser and system shortcuts stay theirs), when it is
 * an auto-repeat (holding a key never answers twice), when it is typed into an input, textarea,
 * select or contenteditable element, and while the shortcuts overlay is open (the overlay is a
 * modal dialog). "?" opens the overlay; any other key goes to the binding that answers it, and a
 * handled key has its default prevented.
 */
import { SHORTCUTS_KEY, findBinding, type HotkeyStore } from "./registry.js";

const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** Returns true when the event opened the overlay or ran a binding. */
export function handleKeydown(store: HotkeyStore, event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return false;
  if (event.defaultPrevented) return false; // S45 (O-466): a control that handled the key (the matrix grid's arrows) keeps it.
  if (isEditableTarget(event.target)) return false;
  const state = store.getState();
  if (state.overlayOpen) return false;
  if (event.key === SHORTCUTS_KEY) {
    event.preventDefault();
    state.setOverlayOpen(true);
    return true;
  }
  const binding = findBinding(state.bindings, event.key);
  if (binding === undefined) return false;
  event.preventDefault();
  binding.handler();
  return true;
}
