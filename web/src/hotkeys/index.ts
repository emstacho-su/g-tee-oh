/** The keyboard-first hotkey system (S24, S46, A7 section 4, R3.13, R3.30). Mount HotkeyRoot once in the shell. */
export { HotkeyRoot } from "./HotkeyRoot.js";
export type { HotkeyRootProps } from "./HotkeyRoot.js";
export { ShortcutsOverlay, displayBinding, displayKey } from "./ShortcutsOverlay.js";
export { useHotkey } from "./use-hotkey.js";
export { HotkeyStoreContext, useHotkeyStore } from "./context.js";
export { handleKeydown, isActivatableTarget, isEditableTarget } from "./dispatch.js";
export { REPEAT_HAND_DESCRIPTION, REPEAT_HAND_KEY, RESERVED_KEYS } from "./reserved.js";
export type { ReservedKey } from "./reserved.js";
export {
  GENERAL_SCOPE,
  SHORTCUTS_DESCRIPTION,
  SHORTCUTS_KEY,
  activeBindings,
  bindingMatches,
  createHotkeyStore,
  defaultHotkeyStore,
  findBinding,
  normalizeKey,
} from "./registry.js";
export type { HotkeyBinding, HotkeyState, HotkeyStore, RegisteredBinding } from "./registry.js";
