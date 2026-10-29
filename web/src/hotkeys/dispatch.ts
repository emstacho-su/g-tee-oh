/**
 * Keydown dispatch for the hotkey registry (S24, S46, A7 section 4, R3.13, R3.30).
 *
 * Mechanism: HotkeyRoot installs one window keydown listener that calls handleKeydown. A key is
 * ignored when it carries ctrl, alt or meta (browser and system shortcuts stay theirs), when it is
 * an auto-repeat (holding a key never answers twice), when it is typed into an input, textarea,
 * select or contenteditable element, and while the shortcuts overlay is open (the overlay is a
 * modal dialog). Enter and Space pressed while a control has focus (a button, link, summary or
 * field, or an element with the role button, link, menuitem, tab, checkbox, radio, switch or
 * option) are that control's: a binding answers them only when it asks to (fromControls, the
 * quiz's submit), so Enter on a focused End session or Ask button never deals the next hand (S46,
 * PR #45 review round 1, finding 2). "?" opens the overlay; any other key goes to the binding that
 * answers it in the event's shift state (registry.ts, O-474), and a handled key has its default
 * prevented.
 */
import { SHORTCUTS_KEY, findBinding, type HotkeyStore } from "./registry.js";

const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';
/** Controls whose own Enter and Space activate them. */
const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "input",
  "select",
  "textarea",
  ...["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "option"].map((role) => `[role="${role}"]`),
].join(", ");
/** The keys a focused control keeps for itself. */
const CONTROL_KEYS: ReadonlySet<string> = new Set(["Enter", " "]);

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** A focused control: Enter and Space are its own activation keys. */
export function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;
}

/** Returns true when the event opened the overlay or ran a binding. */
export function handleKeydown(store: HotkeyStore, event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return false;
  if (isEditableTarget(event.target)) return false;
  const state = store.getState();
  if (state.overlayOpen) return false;
  if (event.key === SHORTCUTS_KEY) {
    event.preventDefault();
    state.setOverlayOpen(true);
    return true;
  }
  const binding = findBinding(state.bindings, event.key, event.shiftKey);
  if (binding === undefined) return false;
  if (CONTROL_KEYS.has(event.key) && isActivatableTarget(event.target) && binding.fromControls !== true) return false;
  event.preventDefault();
  binding.handler();
  return true;
}
