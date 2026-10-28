/**
 * The trainer session hook in spot mode (S25, R3.13, R3.11, O-197, O-232, O-284, A7 section 4).
 *
 * Mechanism: one SpotDriver per mounted screen (spot-driver.ts) runs the pure machine
 * (spot-machine.ts) and its requests; the hook binds the driver's input and output to the app: the
 * generated api client (session-api.ts, AUTO_CSRF_HEADER on every POST and the Idempotency-Key
 * header), the TanStack Query cache for the prompt prefetch (nextPromptQuery, so Next reads the
 * prompt fetched while the feedback showed), the trainer-table store (each prompt goes in through
 * setPrompt, and the store is cleared when the screen unmounts), and the injected clock and key
 * factory (trainer-deps.tsx). A 401 from any request sets the me query to null, which the
 * authenticated layout turns into a trip to /login (query-client.ts does the same for queries).
 * The input and output are read through a ref, so the driver always uses the latest api, cache,
 * drill id and seed without being rebuilt. On unmount the driver is disposed, so a response that
 * arrives later writes neither the screen state nor the store; the mount effect activates it again,
 * which React's development double mount needs. The paused option stops the response timer while a
 * dialog covers the screen and restarts it when the dialog closes (O-284).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ME_QUERY_KEY, useAppApi } from "../auth/index.js";
import type { ConfidenceChoice } from "../components/trainer/index.js";
import { useTrainerTableStore } from "../store/index.js";
import { createSession, endSession, fetchNextPrompt, nextPromptQuery, submitDecision } from "./session-api.js";
import { createSpotDriver, type SpotIo } from "./spot-driver.js";
import { INITIAL_SPOT_STATE, type SpotState } from "./spot-machine.js";
import { useTrainerDeps } from "./trainer-deps.js";

export interface SpotSessionOptions {
  drillId: string;
  /** The O-288 replay seed, passed to POST /sessions when present. */
  seed: string | undefined;
  /** True while a dialog covers the screen: the response timer stops (O-284). */
  paused: boolean;
}

export interface SpotSession {
  state: SpotState;
  start: (rng: boolean) => void;
  /** Takes NodeAction.index (O-198). */
  chooseAction: (actionIndex: number) => void;
  tapConfidence: (confidence: ConfidenceChoice) => void;
  next: () => void;
  end: () => void;
  retry: () => void;
  reset: () => void;
}

function useSpotIo({ drillId, seed }: Omit<SpotSessionOptions, "paused">): SpotIo {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const { now, newKey } = useTrainerDeps();
  const setPrompt = useTrainerTableStore((store) => store.setPrompt);
  return {
    createSession: (rng, key) => createSession(api, { drillId, rng, seed, key }),
    loadPrompt: (sessionId, version) =>
      version === null ? fetchNextPrompt(api, sessionId) : queryClient.fetchQuery(nextPromptQuery(api, sessionId, version)),
    prefetchPrompt: (sessionId, version) => {
      // prefetchQuery never rejects; a failed prefetch leaves no data, so Next simply reads again.
      void queryClient.prefetchQuery(nextPromptQuery(api, sessionId, version));
    },
    submitDecision: (sessionId, decision) => submitDecision(api, sessionId, decision),
    endSession: (sessionId, key) => endSession(api, sessionId, key),
    onPrompt: setPrompt,
    onProblem: (problem) => {
      if (problem.kind === "signed_out") queryClient.setQueryData(ME_QUERY_KEY, null);
    },
    now,
    newKey,
  };
}

export function useSpotSession(options: SpotSessionOptions): SpotSession {
  const io = useSpotIo(options);
  const ioRef = useRef(io);
  useLayoutEffect(() => {
    ioRef.current = io;
  });
  const { now, newKey } = useTrainerDeps();
  const [state, setState] = useState<SpotState>(INITIAL_SPOT_STATE);
  const [driver] = useState(() => createSpotDriver(() => ioRef.current, setState));
  const clearTable = useTrainerTableStore((store) => store.clear);
  useEffect(() => {
    driver.activate();
    return () => {
      driver.dispose();
      clearTable();
    };
  }, [driver, clearTable]);
  const { send } = driver;
  // A newly shown prompt starts its timer running, so it is paused again when a dialog is open.
  const shownPrompt = state.kind === "await_action" ? state.prompt : null;
  const { paused } = options;
  useEffect(() => {
    send(paused ? { type: "pause", at: now() } : { type: "resume", at: now() });
  }, [paused, shownPrompt, send, now]);
  return {
    state,
    start: (rng) => send({ type: "start", key: newKey(), rng }),
    chooseAction: (actionIndex) => send({ type: "choose_action", actionIndex, at: now() }),
    tapConfidence: (confidence) => send({ type: "confidence", confidence, key: newKey() }),
    next: () => send({ type: "next" }),
    end: () => send({ type: "end", key: newKey() }),
    retry: () => send({ type: "retry" }),
    reset: () => send({ type: "reset" }),
  };
}
