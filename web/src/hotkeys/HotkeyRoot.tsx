/**
 * HotkeyRoot, the one keyboard listener of the app (S24, A7 section 4, R3.13). Mount it once in
 * the shell. It installs a single window keydown listener that hands every key to handleKeydown,
 * provides the hotkey store to its children, and renders the ShortcutsOverlay. Without a store
 * prop it uses the app-wide default store, which useHotkey also reads by default, so children are
 * optional: <HotkeyRoot /> beside the routes is enough.
 */
import { useEffect, type ReactNode } from "react";

import { HotkeyStoreContext } from "./context.js";
import { handleKeydown } from "./dispatch.js";
import { defaultHotkeyStore, type HotkeyStore } from "./registry.js";
import { ShortcutsOverlay } from "./ShortcutsOverlay.js";

export interface HotkeyRootProps {
  store?: HotkeyStore;
  children?: ReactNode;
}

export function HotkeyRoot({ store = defaultHotkeyStore, children }: HotkeyRootProps) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleKeydown(store, event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [store]);
  return (
    <HotkeyStoreContext.Provider value={store}>
      {children}
      <ShortcutsOverlay />
    </HotkeyStoreContext.Provider>
  );
}
