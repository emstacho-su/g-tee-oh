/**
 * Trainer table state (R3.13, A7 section 3). Holds the TrainerPrompt the api last served (seats,
 * stacks, pot, board, history, buttons, state_version) exactly as received; the web never
 * recomputes poker math (ADR 0004). S25 wires sessions into it. Zustand with immutable updates:
 * every set replaces the state object.
 */
import { create } from "zustand";

import type { TrainerPrompt } from "../contracts.js";

export interface TrainerTableState {
  prompt: TrainerPrompt | null;
  setPrompt: (prompt: TrainerPrompt) => void;
  clear: () => void;
}

export function createTrainerTableStore() {
  return create<TrainerTableState>()((set) => ({
    prompt: null,
    setPrompt: (prompt) => set({ prompt }),
    clear: () => set({ prompt: null }),
  }));
}

/** The app's trainer table store. */
export const useTrainerTableStore = createTrainerTableStore();
