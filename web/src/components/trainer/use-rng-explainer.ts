/**
 * Open state and first-use memory for the RNG explainer (S25, R3.10, O-283, O-285).
 * SCAFFOLD: Lane C implements it (first use remembered in localStorage gto-rng-explainer-seen
 * inside try and catch, the I hotkey); the returned shape is final.
 */
import { useState } from "react";

export interface RngExplainerControl {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the explainer when this browser has never seen it, and remembers that it has. */
  showIfFirstUse: () => void;
}

export interface UseRngExplainerOptions {
  /** Whether the I hotkey is registered; off when RNG mode is off. */
  hotkey?: boolean;
}

export function useRngExplainer(options: UseRngExplainerOptions = {}): RngExplainerControl {
  void options;
  const [open, setOpen] = useState(false);
  return { open, setOpen, showIfFirstUse: () => undefined };
}
