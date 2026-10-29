/**
 * Keydown dispatch for the hotkey registry (S24, S46, A7 section 4, R3.13, R3.30).
 *
 * Mechanism: HotkeyRoot installs one window keydown listener that calls handleKeydown. A key is
 * ignored when it carries ctrl, alt or meta (browser and system shortcuts stay theirs), when it is
 * an auto-repeat (holding a key never answers twice), when it is typed into an input, textarea,
 * select or contenteditable element, and while the shortcuts overlay is open (the overlay is a
 * modal dialog). Space pressed on a focused button, link or summary, and Enter pressed on a focused
 * link, summary or disclosure-like control (aria-expanded or aria-haspopup), are left to that
 * control (S46: Enter means next hand, so a Disclosure toggled with Enter must keep its key). "?"
 * opens the overlay; any other key goes to the binding that answers it in the event's shift state
 * (registry.ts, O-474), and a handled key has its default prevented.
 */
import { SHORTCUTS_KEY, findBinding, type HotkeyStore } from "./registry.js";

const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';
/** Controls whose own Space activates them. */
const ACTIVATABLE_SELECTOR = 'button, a[href], summary, [role="button"], [role="link"]';
/**
 * Controls that keep Enter: links and summaries (Enter follows or opens them) and disclosure-like
 * controls (aria-expanded, aria-haspopup: the feedback sections, tips and menus). A plain button
 * keeps Space but yields Enter to a binding, as it did before S46, so a quiz option pressed and
 * then Enter still submits (R3.16); Space activates it on its own.
 */
const ENTER_KEEPING_SELECTOR = 'a[href], summary, [role="link"], [aria-expanded], [aria-haspopup]';
const ENTER_KEY = "Enter";
const SPACE_KEY = " ";

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** A focused button, link or summary: Space is its own activation key. */
export function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ACTIVATABLE_SELECTOR) !== null;
}

/** A focused link, summary or disclosure-like control: Enter is its own key. */
export function keepsEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ENTER_KEEPING_SELECTOR) !== null;
}

/** Whether a focused control keeps this key for itself (S46, R3.30). */
export function controlKeepsKey(key: string, target: EventTarget | null): boolean {
  if (key === SPACE_KEY) return isActivatableTarget(target);
  if (key === ENTER_KEY) return keepsEnter(target);
  return false;
}

/** Returns true when the event opened the overlay or ran a binding. */
export function handleKeydown(store: HotkeyStore, event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return false;
  if (isEditableTarget(event.target)) return false;
  if (controlKeepsKey(event.key, event.target)) return false;
  const state = store.getState();
  if (state.overlayOpen) return false;
  if (event.key === SHORTCUTS_KEY) {
    event.preventDefault();
    state.setOverlayOpen(true);
    return true;
  }
  const binding = findBinding(state.bindings, event.key, event.shiftKey);
  if (binding === undefined) return false;
  event.preventDefault();
  binding.handler();
  return true;
}
