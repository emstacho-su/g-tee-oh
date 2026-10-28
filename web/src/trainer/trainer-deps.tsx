/**
 * The trainer's injected dependencies (S25, S26, R3.13, O-284, O-314): the clock that times a
 * decision, the Idempotency-Key factory and the timer that continues a reveal that does not pause.
 * The app uses performance.now, crypto.randomUUID and setTimeout; a test puts its own in the
 * provider, so response_ms, the keys and the automatic continue are exact and the state machine
 * stays pure. schedule is optional so a provider written before S26 keeps working: useTrainerDeps
 * fills in the default timer.
 */
import { createContext, useContext, type ReactNode } from "react";

import { createKeyFactory, type KeyFactory } from "./idempotency.js";

/** Runs `run` once after `delayMs`; the returned function cancels it if it has not run yet. */
export type Scheduler = (run: () => void, delayMs: number) => () => void;

export interface TrainerDeps {
  /** Milliseconds from an arbitrary origin; only differences are used. */
  now: () => number;
  newKey: KeyFactory;
  schedule?: Scheduler;
}

export const defaultScheduler: Scheduler = (run, delayMs) => {
  const handle = setTimeout(run, delayMs);
  return () => clearTimeout(handle);
};

export const defaultTrainerDeps: TrainerDeps = {
  now: () => performance.now(),
  newKey: createKeyFactory(),
  schedule: defaultScheduler,
};

const TrainerDepsContext = createContext<TrainerDeps>(defaultTrainerDeps);

export interface TrainerDepsProviderProps {
  deps: TrainerDeps;
  children: ReactNode;
}

export function TrainerDepsProvider({ deps, children }: TrainerDepsProviderProps) {
  return <TrainerDepsContext.Provider value={deps}>{children}</TrainerDepsContext.Provider>;
}

export function useTrainerDeps(): Required<TrainerDeps> {
  const deps = useContext(TrainerDepsContext);
  return { now: deps.now, newKey: deps.newKey, schedule: deps.schedule ?? defaultScheduler };
}
