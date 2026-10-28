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
 *
 * S32 (R4.10, O-325, O-328): a session starts from a SessionStartSpec, one of three modes.
 * sessionCreateBody turns it and the RNG choice into the POST /sessions body: a drill session sends
 * its drill id, settings.rng and the replay seed when one is given (O-288); an automated session
 * sends settings.grouping and settings.rng (the only settings the api honours,
 * services/api/src/automated/settings.ts) and config_ids only when a scope was chosen, and never a
 * seed, since a client seed makes the session unrated; a holdout retest sends its mode alone (the
 * api fixes its settings and refuses a seed).
 */
import type { ApiPaths } from "@g-tee-oh/contracts";
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { DecisionFeedback, Grouping, TrainerPrompt } from "../contracts.js";
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

/** How a session starts (S32): a drill run, an automated session or this month's holdout retest. */
export type SessionStartSpec =
  | { readonly mode: "drill"; readonly drillId: string; readonly seed: string | undefined }
  | {
      readonly mode: "automated";
      readonly grouping: Grouping;
      /** The configurations in scope; null means every covered configuration (the api's default). */
      readonly configIds: readonly string[] | null;
    }
  | { readonly mode: "holdout" };

export type SessionCreateBody = ApiPaths["/api/v1/sessions"]["post"]["requestBody"]["content"]["application/json"];

/** The POST /sessions body for a start spec and the RNG choice; an automated body never has a seed. */
export function sessionCreateBody(spec: SessionStartSpec, rng: boolean): SessionCreateBody {
  switch (spec.mode) {
    case "drill":
      return { mode: "drill", drill_id: spec.drillId, settings: { rng }, ...(spec.seed === undefined ? {} : { seed: spec.seed }) };
    case "automated":
      return { mode: "automated", settings: { grouping: spec.grouping, rng }, ...(spec.configIds === null ? {} : { config_ids: [...spec.configIds] }) };
    case "holdout":
      return { mode: "holdout" };
  }
}

export interface StartSessionInput {
  spec: SessionStartSpec;
  rng: boolean;
  key: string;
}

export async function createSession(api: AppApi, { spec, rng, key }: StartSessionInput): Promise<PracticeSession> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions", {
    params: { header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: sessionCreateBody(spec, rng),
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
