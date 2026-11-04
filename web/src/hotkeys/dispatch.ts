/**
 * Keydown dispatch for the hotkey registry (S24, S46, A7 section 4, R3.13, R3.30).
 *
 * Mechanism: HotkeyRoot installs one window keydown listener that calls handleKeydown. A key is
 * ignored when it carries ctrl, alt or meta (browser and system shortcuts stay theirs), when it is
 * an auto-repeat (holding a key never answers twice), when it is typed into an input, textarea,
 * select or contenteditable element, and while the shortcuts overlay is open (the overlay is a
 * modal dialog), and when a widget already handled it (defaultPrevented). Enter and Space pressed
 * while a control has focus (a button, link, summary or field, an element with the role button,
 * link, menuitem, tab, checkbox, radio, switch or option, or any element with a tabindex of 0 or
 * more; never a disabled one) are that control's: a binding answers them only when it asks to
 * (fromControls, the quiz's submit), so Enter on a focused End session or Ask button, or on the
 * range matrix, never deals the next hand (S46, PR #45 review rounds 1 and 2). The listener runs
 * in the bubble phase on window. "?" opens the overlay; any other key goes to the binding that
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

/** Any element the keyboard reaches on its own (tabindex 0 or more): a widget such as the range matrix. */
const FOCUSABLE_SELECTOR = '[tabindex]:not([tabindex^="-"])';
/** A control that is switched off is no control: its keys belong to the page again. */
const DISABLED_SELECTOR = ':disabled, [aria-disabled="true"]';

/**
 * A focused control, whose own Enter and Space activate it: a button, link, summary or field, an
 * element with a control role, or any element with a tabindex of 0 or more (a custom widget). A
 * disabled control is none, since the focus can stay on a button that the trainer disabled after
 * the choice (PR #45 review round 2, findings 1 and 2). The body is never a control.
 */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) return false;
  const control = target.closest(`${CONTROL_SELECTOR}, ${FOCUSABLE_SELECTOR}`);
  return control !== null && control !== document.body && !control.matches(DISABLED_SELECTOR);
}

/** Returns true when the event opened the overlay or ran a binding. */
export function handleKeydown(store: HotkeyStore, event: KeyboardEvent): boolean {
  // A widget that handled its own key wins: the range matrix selects a cell on Enter and prevents
  // the default. React handles the element's keydown at the root before this window listener
  // (bubble phase), so the flag is already set here (PR #45 review round 2, finding 1).
  if (event.defaultPrevented) return false;
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
