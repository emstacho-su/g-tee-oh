/**
 * useHotkey registers one binding while the calling component is mounted (S24, R3.13).
 *
 * Mechanism: an effect registers the binding on mount and unregisters it on unmount, or when the
 * key, description, scope or enabled flag changes. The handler is read through a ref that tracks
 * the latest render, so a new handler each render neither re-registers nor runs stale state.
 * With enabled false nothing is registered, so a disabled control has no live hotkey.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import { useHotkeyStore } from "./context.js";
import type { HotkeyBinding } from "./registry.js";

export function useHotkey(binding: HotkeyBinding, enabled = true): void {
  const store = useHotkeyStore();
  const handlerRef = useRef(binding.handler);
  useLayoutEffect(() => {
    handlerRef.current = binding.handler;
  });
  const { key, description, scope } = binding;
  useEffect(() => {
    if (!enabled) return undefined;
    const id = store.getState().register({ key, description, scope, handler: () => handlerRef.current() });
    return () => store.getState().unregister(id);
  }, [store, key, description, scope, enabled]);
}
