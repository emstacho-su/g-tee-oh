/**
 * The React context that carries the hotkey store (S24, R3.13). It defaults to the app-wide
 * store, so a component using useHotkey works under a bare <HotkeyRoot /> mounted anywhere in the
 * shell; a HotkeyRoot given its own store (tests, isolated previews) provides that store instead.
 */
import { createContext, useContext } from "react";

import { defaultHotkeyStore, type HotkeyStore } from "./registry.js";

export const HotkeyStoreContext = createContext<HotkeyStore>(defaultHotkeyStore);

export function useHotkeyStore(): HotkeyStore {
  return useContext(HotkeyStoreContext);
}
