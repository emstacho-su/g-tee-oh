/** The keyboard-first hotkey system (S24, A7 section 4, R3.13). Mount HotkeyRoot once in the shell. */
export { HotkeyRoot } from "./HotkeyRoot.js";
export type { HotkeyRootProps } from "./HotkeyRoot.js";
export { ShortcutsOverlay, displayKey } from "./ShortcutsOverlay.js";
export { useHotkey } from "./use-hotkey.js";
export { HotkeyStoreContext, useHotkeyStore } from "./context.js";
export { handleKeydown, isEditableTarget } from "./dispatch.js";
export {
  GENERAL_SCOPE,
  SHORTCUTS_DESCRIPTION,
  SHORTCUTS_KEY,
  activeBindings,
  createHotkeyStore,
  defaultHotkeyStore,
  findBinding,
  normalizeKey,
} from "./registry.js";
export type { HotkeyBinding, HotkeyState, HotkeyStore, RegisteredBinding } from "./registry.js";
