/**
 * Open state and first-use memory for the RNG (random number generator) mode explainer (S25,
 * R3.10, O-283, O-285).
 *
 * Mechanism: open is plain React state. showIfFirstUse() opens the explainer when this browser
 * has not seen it (rng-explainer-memory.ts reads localStorage key gto-rng-explainer-seen inside
 * try and catch) and records that it has. When the storage is missing or fails, nothing can be
 * remembered across page loads, so the explainer shows on every first use (O-283); a ref still
 * remembers it for this mount, so a screen that calls showIfFirstUse on every RNG prompt shows it
 * once per mount rather than on every hand. The I key opens it at any time, registered through
 * useHotkey under the "RNG mode" scope so the ? overlay lists it (O-285), unless options.hotkey
 * is false (RNG mode off).
 */
import { useCallback, useRef, useState } from "react";

import { useHotkey } from "../../hotkeys/index.js";
import {
  defaultExplainerStorage,
  readExplainerSeen,
  rememberExplainerSeen,
  type ExplainerStorageSource,
} from "./rng-explainer-memory.js";

export const RNG_EXPLAINER_KEY = "i";
export const RNG_EXPLAINER_SCOPE = "RNG mode";
export const RNG_EXPLAINER_TITLE = "How RNG mode works";

export interface RngExplainerControl {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the explainer when this browser has never seen it, and remembers that it has. */
  showIfFirstUse: () => void;
}

export interface UseRngExplainerOptions {
  /** Whether the I hotkey is registered; off when RNG mode is off. */
  hotkey?: boolean;
  /** Where the seen flag lives; window.localStorage, read lazily, by default. For tests. */
  storage?: ExplainerStorageSource;
}

export function useRngExplainer(options: UseRngExplainerOptions = {}): RngExplainerControl {
  const { hotkey = true, storage = defaultExplainerStorage } = options;
  const [open, setOpen] = useState(false);
  const shownThisMount = useRef(false);

  const showIfFirstUse = useCallback(() => {
    if (shownThisMount.current || readExplainerSeen(storage) === "seen") return;
    shownThisMount.current = true;
    rememberExplainerSeen(storage);
    setOpen(true);
  }, [storage]);

  useHotkey(
    { key: RNG_EXPLAINER_KEY, description: RNG_EXPLAINER_TITLE, scope: RNG_EXPLAINER_SCOPE, handler: () => setOpen(true) },
    hotkey,
  );

  return { open, setOpen, showIfFirstUse };
}
