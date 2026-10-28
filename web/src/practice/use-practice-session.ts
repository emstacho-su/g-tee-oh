/**
 * The life of one practice session on the server, owned by the run that started it (S41, R3.16,
 * R3.17, O-232, O-275, O-419, PR #41 review round 1). Shared by the quiz run (/quiz) and the
 * painting start (/paint).
 *
 * Mechanism:
 * - Start: the run mounts only after the player's Start (use-start-arm.ts) and posts POST /sessions
 *   once on mount through the caller's create function; a ref keeps a second effect run (React's
 *   development double mount) from posting again.
 * - End: one end per session. end() posts POST /sessions/{id}/end under one Idempotency-Key per
 *   session and hands every later caller the same request while it runs or once it succeeded, so
 *   End quiz and leaving the run send one logical end. A failed end is forgotten (the key is kept),
 *   so a later end retries it and the server replays it if the first one did land.
 * - Leaving: when the run unmounts for any reason (another address, another route, a sign-out),
 *   a deferred cleanup ends its session. The cleanup waits one timer tick and does nothing if the
 *   run mounted again in between, which is what StrictMode's double mount does, so a live session
 *   is never ended by it. A start that resolves after the run was left ends its new session from
 *   the mutation's own onSuccess, which runs even though the run is gone.
 * - Sign-out: the run registers a sign-out task (auth/sign-out-tasks.ts), so its session is ended
 *   before the logout, while the cookie and csrf token still work; a start in flight is waited for.
 * - Tab close: on pagehide (not a back-forward cache entry, where the page may come back) the end
 *   is sent with keepalive, which lets the browser finish it after the page is gone. It goes
 *   through the same api client, so it carries the csrf token and the session's Idempotency-Key.
 *   It is best effort; the idle-session closer (O-275) ends whatever it misses.
 * - A failed end on leaving is logged with its status and problem slug only (describeFailureForLog),
 *   never dropped; a failed End quiz is the run's to show.
 */
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { describeFailureForLog } from "../api/http-status.js";
import { registerSignOutTask, useAppApi } from "../auth/index.js";
import type { SessionRecap } from "../progress/types.js";
import { endSession, type EndSessionOptions } from "../trainer/session-api.js";
import { useTrainerDeps } from "../trainer/trainer-deps.js";

/**
 * How long an unmounted run waits before it ends its session. StrictMode remounts within the same
 * commit, so one timer tick is enough to tell its double mount from a real leave.
 */
export const REMOUNT_GRACE_MS = 0;

export interface PracticeSessionLife<T> {
  /** The start mutation (POST /sessions), for the run's loading and failure states and Try again. */
  start: UseMutationResult<T, Error, void>;
  sessionId: string | undefined;
  /** Ends the session once (null when there is none); every caller shares the one request. */
  end: () => Promise<SessionRecap | null>;
  /** False once the run has unmounted, so a late success never navigates from a screen it left. */
  isMounted: () => boolean;
}

interface Ending {
  sessionId: string;
  promise: Promise<SessionRecap>;
}

function reportLeftEnd(error: unknown): void {
  console.error(`g-tee-oh: ending the practice session on leaving failed (${describeFailureForLog(error)}); the idle-session closer will end it`);
}

/** One Idempotency-Key per session's end, kept across retries so a repeated end replays (O-232). */
function useEndKeys(): (sessionId: string) => string {
  const { newKey } = useTrainerDeps();
  const keys = useRef<ReadonlyMap<string, string>>(new Map());
  return useCallback(
    (sessionId) => {
      const known = keys.current.get(sessionId);
      if (known !== undefined) return known;
      const key = newKey();
      keys.current = new Map([...keys.current, [sessionId, key]]);
      return key;
    },
    [newKey],
  );
}

export function usePracticeSession<T extends { session_id: string }>(create: () => Promise<T>): PracticeSessionLife<T> {
  const api = useAppApi();
  const endKeyFor = useEndKeys();
  const session = useRef<string | undefined>(undefined);
  const starting = useRef<Promise<T> | null>(null);
  const ending = useRef<Ending | null>(null);
  const mounted = useRef(false);
  const left = useRef(false);

  const end = useCallback(
    (options: EndSessionOptions = {}): Promise<SessionRecap | null> => {
      const sessionId = session.current;
      if (sessionId === undefined) return Promise.resolve(null);
      if (ending.current?.sessionId === sessionId) return ending.current.promise;
      const promise = endSession(api, sessionId, endKeyFor(sessionId), options);
      ending.current = { sessionId, promise };
      // A failure is the caller's to handle; forgetting it here lets the next end retry.
      promise.then(undefined, () => {
        if (ending.current?.promise === promise) ending.current = null;
      });
      return promise;
    },
    [api, endKeyFor],
  );

  const leave = useCallback(
    async (options: EndSessionOptions = {}): Promise<void> => {
      try {
        await end(options);
      } catch (error) {
        reportLeftEnd(error);
      }
    },
    [end],
  );

  const start = useMutation({
    mutationFn: () => {
      const created = create().then((value) => {
        session.current = value.session_id;
        return value;
      });
      starting.current = created;
      return created;
    },
    // Runs even when the run has unmounted: a session that arrives after the player left is ended.
    onSuccess: () => {
      if (left.current) void leave();
    },
  });

  const requested = useRef(false);
  const { mutate } = start;
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    mutate();
  }, [mutate]);

  useEffect(() => {
    mounted.current = true;
    const unregister = registerSignOutTask(api, async () => {
      // A start in flight is waited for; its failure is the run's to show, and leaves nothing to end.
      if (starting.current !== null) await Promise.allSettled([starting.current]);
      await leave();
    });
    const onPageHide = (event: Event) => {
      const persisted = "persisted" in event && event.persisted === true;
      if (!persisted) void leave({ keepalive: true });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mounted.current = false;
      unregister();
      window.removeEventListener("pagehide", onPageHide);
      setTimeout(() => {
        if (mounted.current) return;
        left.current = true;
        void leave();
      }, REMOUNT_GRACE_MS);
    };
  }, [api, leave]);

  const isMounted = useCallback(() => mounted.current, []);
  const endNow = useCallback(() => end(), [end]);
  return { start, sessionId: start.data?.session_id, end: endNow, isMounted };
}
