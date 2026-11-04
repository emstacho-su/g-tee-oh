/**
 * useHotkey registers one binding while the calling component is mounted (S24, S46, R3.13, R3.30).
 *
 * Mechanism: an effect registers the binding on mount and unregisters it on unmount, or when the
 * key, shift flag, description, scope or enabled flag changes. The handler is read through a ref
 * that tracks the latest render, so a new handler each render neither re-registers nor runs stale
 * state. With enabled false nothing is registered, so a disabled control has no live hotkey.
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
  const shift = binding.shift ?? false;
  useEffect(() => {
    if (!enabled) return undefined;
    const id = store.getState().register({ key, shift, description, scope, handler: () => handlerRef.current() });
    return () => store.getState().unregister(id);
  }, [store, key, shift, description, scope, enabled]);
}
