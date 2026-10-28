/**
 * End quiz (S41, R3.16, O-414): POST /sessions/{id}/end with the csrf token and one
 * Idempotency-Key for the life of the run, so a repeated click replays the first end. On success
 * the caller leaves the run (back to the start screen), which unmounts it and drops its answered
 * list; a failure stays on the run for the screen to show as fixed text. A run whose start failed
 * has no session to end and goes straight back.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useAppApi } from "../auth/index.js";
import { useTrainerDeps } from "../trainer/trainer-deps.js";
import { endPredictionSession } from "./api.js";

export interface EndQuiz {
  end: () => void;
  ending: boolean;
  failed: boolean;
}

export function useEndQuiz(sessionId: string | undefined, onEnded: () => void): EndQuiz {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const [key] = useState(newKey);
  const mutation = useMutation({
    mutationFn: (id: string) => endPredictionSession(api, id, key),
    onSuccess: onEnded,
  });
  return {
    end: () => {
      // A start that never produced a session has nothing to end: go straight back.
      if (sessionId === undefined) onEnded();
      else if (!mutation.isPending) mutation.mutate(sessionId);
    },
    ending: mutation.isPending,
    failed: mutation.isError,
  };
}
