/**
 * The trainer's injected dependencies (S25, R3.13, O-284): the clock that times a decision and the
 * Idempotency-Key factory. The app uses performance.now and crypto.randomUUID; a test puts its own
 * in the provider, so response_ms and the keys are exact and the state machine stays pure.
 */
import { createContext, useContext, type ReactNode } from "react";

import { createKeyFactory, type KeyFactory } from "./idempotency.js";

export interface TrainerDeps {
  /** Milliseconds from an arbitrary origin; only differences are used. */
  now: () => number;
  newKey: KeyFactory;
}

export const defaultTrainerDeps: TrainerDeps = {
  now: () => performance.now(),
  newKey: createKeyFactory(),
};

const TrainerDepsContext = createContext<TrainerDeps>(defaultTrainerDeps);

export interface TrainerDepsProviderProps {
  deps: TrainerDeps;
  children: ReactNode;
}

export function TrainerDepsProvider({ deps, children }: TrainerDepsProviderProps) {
  return <TrainerDepsContext.Provider value={deps}>{children}</TrainerDepsContext.Provider>;
}

export function useTrainerDeps(): TrainerDeps {
  return useContext(TrainerDepsContext);
}
