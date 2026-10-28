/**
 * End quiz (S41, R3.16, O-414, PR #41 review round 1): ends the session through the run's lifecycle
 * (practice/use-practice-session.ts), which posts POST /sessions/{id}/end once, under one
 * Idempotency-Key per session, and hands a repeated click or a later leave the same request. On
 * success the caller leaves the run (back to the start screen), but only while the run is still
 * mounted: a player who went elsewhere while the end was in flight stays where they went. A failure
 * stays on the run for the screen to show as fixed text. A run whose start never produced a
 * session goes straight back; unmounting it ends a session that arrives later.
 */
import { useMutation } from "@tanstack/react-query";

import type { PracticeSessionLife } from "../practice/use-practice-session.js";

export interface EndQuiz {
  end: () => void;
  ending: boolean;
  failed: boolean;
}

export type EndQuizLife = Pick<PracticeSessionLife<unknown>, "sessionId" | "end" | "isMounted">;

export function useEndQuiz(life: EndQuizLife, onEnded: () => void): EndQuiz {
  const mutation = useMutation({
    mutationFn: life.end,
    onSuccess: () => {
      if (life.isMounted()) onEnded();
    },
  });
  return {
    end: () => {
      if (life.sessionId === undefined) onEnded();
      else if (!mutation.isPending) mutation.mutate();
    },
    ending: mutation.isPending,
    failed: mutation.isError,
  };
}
