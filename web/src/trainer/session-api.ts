/**
 * The trainer's api calls (S25, R3.13, A5 section 3, O-197, O-232, O-249). Each wraps one typed
 * client call; a response without data becomes an ApiProblem through problemFromBody, so callers
 * see the status and slug and never the raw body.
 *
 * - drillQuery: GET /drills/{id}, the start panel's read.
 * - nextPromptQuery: GET /sessions/{id}/next keyed by the session and the state version the
 *   prompt follows. /next is pure (O-249): it writes nothing and answers the same prompt for the
 *   same state, so the screen can prefetch it while the feedback shows and Next reads the cache
 *   (A7 section 4). The cached prompt never goes stale for its version.
 * - fetchNextPrompt: the same read outside the cache, for a stale-state recovery, where the
 *   version the server moved to is unknown.
 * - createSession, submitDecision, endSession: the three POSTs, each with AUTO_CSRF_HEADER (the
 *   csrf fetch fills the token, O-197) and the caller's Idempotency-Key (O-232).
 */
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { DecisionFeedback, TrainerPrompt } from "../contracts.js";
import { IDEMPOTENCY_HEADER } from "./idempotency.js";
import { sessionProblemFromBody } from "./session-problem.js";
import type { Drill, PracticeSession, SessionRecap } from "./session-types.js";
import type { PendingDecision } from "./spot-machine.js";

export const TRAINER_QUERY_ROOT = "trainer";
/** A drill rarely changes while its run screen is open. */
const DRILL_STALE_MS = 60 * 1000;
/** A prefetched prompt is dropped a minute after nothing reads it. */
const PROMPT_GC_MS = 60 * 1000;

export function drillQuery(api: AppApi, drillId: string) {
  return queryOptions({
    queryKey: [TRAINER_QUERY_ROOT, "drill", drillId] as const,
    queryFn: async (): Promise<Drill> => {
      const { data, error, response } = await api.client.GET("/api/v1/drills/{id}", { params: { path: { id: drillId } } });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: DRILL_STALE_MS,
    retry: false,
  });
}

export async function fetchNextPrompt(api: AppApi, sessionId: string): Promise<TrainerPrompt> {
  const { data, error, response } = await api.client.GET("/api/v1/sessions/{id}/next", { params: { path: { id: sessionId } } });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export function nextPromptQuery(api: AppApi, sessionId: string, stateVersion: number) {
  return queryOptions({
    queryKey: [TRAINER_QUERY_ROOT, "next", sessionId, stateVersion] as const,
    queryFn: () => fetchNextPrompt(api, sessionId),
    staleTime: Infinity,
    gcTime: PROMPT_GC_MS,
    retry: false,
  });
}

export interface StartSessionInput {
  drillId: string;
  rng: boolean;
  seed: string | undefined;
  key: string;
}

export async function createSession(api: AppApi, { drillId, rng, seed, key }: StartSessionInput): Promise<PracticeSession> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions", {
    params: { header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: { mode: "drill", drill_id: drillId, settings: { rng }, ...(seed === undefined ? {} : { seed }) },
  });
  // A 422 no-coverage keeps its typed pairs_total and pairs_queued (session-problem.ts, MEDIUM 3).
  if (data === undefined) throw sessionProblemFromBody(response.status, error);
  return data;
}

export async function submitDecision(api: AppApi, sessionId: string, decision: PendingDecision): Promise<DecisionFeedback> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions/{id}/decisions", {
    params: { path: { id: sessionId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: decision.idempotencyKey } },
    body: {
      state_version: decision.stateVersion,
      action_index: decision.actionIndex,
      confidence: decision.confidence,
      response_ms: decision.responseMs,
    },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export async function endSession(api: AppApi, sessionId: string, key: string): Promise<SessionRecap> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions/{id}/end", {
    params: { path: { id: sessionId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: {},
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}
