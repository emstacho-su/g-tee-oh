/**
 * The trainer session hook in spot mode (S25, S37, R3.13, O-197, O-232, O-284, O-345, A7 section 4).
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
 * start spec and callbacks without being rebuilt. On unmount the driver is disposed, so a response that
 * arrives later writes neither the screen state nor the store; the mount effect activates it again,
 * which React's development double mount needs. The paused option stops the response timer while a
 * dialog covers the screen and restarts it when the dialog closes (O-284).
 *
 * Street and full-hand modes (S26, R3.13, O-314): the trainer option (the drill's run settings)
 * goes into Start. When a reveal does not pause (autoContinueDelay is a number), an effect
 * schedules auto_continue through the injected timer (trainer-deps.tsx). The effect's cleanup
 * cancels it whenever the reveal leaves (Next, End, a new state), the screen pauses (a dialog
 * opens: the automatic continue waits, and starts its full delay again when the dialog closes) or
 * the screen unmounts; a timer that still fires after dispose meets a stopped driver.
 *
 * S32 (R4.10, R4.12, O-325, O-326, O-328): the session starts from a start spec (session-api.ts
 * SessionStartSpec: a drill, an automated session or a holdout retest), so /train runs on the same
 * hook as the drill run. The optional onPrompt option sees each prompt as it is shown (the
 * automated screen counts the hands of its block from them). When a session ends and its recap
 * arrives, every progress read is invalidated (invalidateProgress), so the home and /progress
 * cards refetch the rating, streak and the rest (O-326).
 *
 * S46 (R3.31): the sessionLength option rides into Start; Next, the automatic continue and every
 * prompt load carry a fresh end key, which the machine uses only when the planned length is
 * reached (session-length.ts); atLimit tells the screen to offer Finish session.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ME_QUERY_KEY, useAppApi } from "../auth/index.js";
import type { TrainerPrompt } from "../contracts.js";
import { invalidateProgress } from "../progress/queries.js";
import { useTrainerTableStore } from "../store/index.js";
import { createSession, endSession, fetchNextPrompt, nextPromptQuery, submitDecision, type SessionStartSpec } from "./session-api.js";
import { atSessionLimit, type SessionLength } from "./session-length.js";
import type { RunSettings } from "./session-types.js";
import { createSpotDriver, type SpotIo } from "./spot-driver.js";
import { INITIAL_SPOT_STATE, autoContinueDelay, type SpotEvent, type SpotState } from "./spot-machine.js";
import type { ReplaySpeed } from "./action-replay.js";
import { useTrainerDeps, type Scheduler } from "./trainer-deps.js";
import { useActionReplay, type ActionReplay } from "./use-action-replay.js";

export interface SpotSessionOptions {
  /** What POST /sessions starts: a drill (with its O-288 replay seed), an automated session or a holdout retest. */
  spec: SessionStartSpec;
  /**
   * True while a dialog covers the screen: the response timer stops (O-284), and so does the
   * automatic continue. The table's replay pauses both too, inside this hook (O-381).
   */
  paused: boolean;
  /** The drill's run settings (S26, O-314); absent means spot mode. */
  trainer?: RunSettings;
  /** The planned length in hands (S46, R3.31); absent or null means no limit. */
  sessionLength?: SessionLength;
  /** Sees each prompt as it is shown, after the trainer-table store (S32). */
  onPrompt?: (prompt: TrainerPrompt) => void;
}

/** Spot mode and automated sessions have no run settings; their replay plays at the normal speed. */
const DEFAULT_SPEED: ReplaySpeed = "normal";

/** The prompt on screen in a state, if any: the one the table and its replay draw. */
function promptOnScreen(state: SpotState): TrainerPrompt | null {
  switch (state.kind) {
    case "await_action":
    case "submitting":
    case "feedback":
    case "error":
      return state.prompt;
    default:
      return null;
  }
}

/** Schedules auto_continue for a reveal that does not pause, and cancels it as the screen moves on. */
function useAutoContinue(state: SpotState, paused: boolean, schedule: Scheduler, send: (event: SpotEvent) => void, newKey: () => string): void {
  const delay = autoContinueDelay(state);
  // One reveal is one decision; its key tells two reveals in a row apart.
  const reveal = state.kind === "feedback" ? state.decision.idempotencyKey : null;
  useEffect(() => {
    if (delay === null || reveal === null || paused) return undefined;
    // The end key is used only when this reveal is the last planned hand's (R3.31).
    return schedule(() => send({ type: "auto_continue", endKey: newKey() }), delay);
  }, [delay, reveal, paused, schedule, send, newKey]);
}

export interface SpotSession {
  state: SpotState;
  /** The table's replay of the line before the decision; the timer is paused while it plays (O-381). */
  replay: ActionReplay;
  /** True on the reveal of the last planned hand: Next finishes the session (S46, R3.31). */
  atLimit: boolean;
  start: (rng: boolean) => void;
  /** Takes NodeAction.index (O-198); choosing submits the decision (O-345). */
  chooseAction: (actionIndex: number) => void;
  next: () => void;
  end: () => void;
  retry: () => void;
  reset: () => void;
}

function useSpotIo({ spec, onPrompt }: Pick<SpotSessionOptions, "spec" | "onPrompt">): SpotIo {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const { now, newKey } = useTrainerDeps();
  const setPrompt = useTrainerTableStore((store) => store.setPrompt);
  return {
    createSession: (rng, key) => createSession(api, { spec, rng, key }),
    loadPrompt: (sessionId, version) =>
      version === null ? fetchNextPrompt(api, sessionId) : queryClient.fetchQuery(nextPromptQuery(api, sessionId, version)),
    prefetchPrompt: (sessionId, version) => {
      // prefetchQuery never rejects; a failed prefetch leaves no data, so Next simply reads again.
      void queryClient.prefetchQuery(nextPromptQuery(api, sessionId, version));
    },
    submitDecision: (sessionId, decision) => submitDecision(api, sessionId, decision),
    endSession: async (sessionId, key) => {
      const recap = await endSession(api, sessionId, key);
      // The rating, streak and the rest moved; a failed refetch shows on its own card (O-326).
      void invalidateProgress(queryClient);
      return recap;
    },
    onPrompt: (prompt) => {
      setPrompt(prompt);
      onPrompt?.(prompt);
    },
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
  const { now, newKey, schedule } = useTrainerDeps();
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
  const { paused: dialogOpen, trainer, sessionLength = null } = options;
  // The table's replay of the line before the decision (S38, O-381) lives here, beside the timer,
  // so the render that shows a prompt with a line to replay already counts as paused: the timer
  // gets a pause, never a resume first (review round 1, finding 10).
  const replay = useActionReplay(promptOnScreen(state), { speed: trainer?.speed ?? DEFAULT_SPEED, keySkip: !dialogOpen });
  const paused = dialogOpen || replay.replaying;
  // A newly shown prompt starts its timer running, so it is paused again when a dialog is open.
  const shownPrompt = state.kind === "await_action" ? state.prompt : null;
  useEffect(() => {
    send(paused ? { type: "pause", at: now() } : { type: "resume", at: now() });
  }, [paused, shownPrompt, send, now]);
  useAutoContinue(state, paused, schedule, send, newKey);
  return {
    state,
    replay,
    atLimit: atSessionLimit(state),
    start: (rng) =>
      send({
        type: "start",
        key: newKey(),
        rng,
        ...(trainer === undefined ? {} : { trainer }),
        ...(sessionLength === null ? {} : { length: sessionLength }),
      }),
    chooseAction: (actionIndex) => send({ type: "choose_action", actionIndex, at: now(), key: newKey() }),
    // The end key is used only on the last planned hand's reveal (R3.31).
    next: () => send({ type: "next", endKey: newKey() }),
    end: () => send({ type: "end", key: newKey() }),
    retry: () => send({ type: "retry" }),
    reset: () => send({ type: "reset" }),
  };
}
