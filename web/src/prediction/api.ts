/**
 * The prediction drill's api calls (S27 lane A, R3.16, A5 section 3, O-197, O-232, O-302). Each
 * wraps one typed client call; a response without data becomes an ApiProblem through
 * problemFromBody, so callers see the status and slug and never the raw body or its detail.
 *
 * - drillListQuery: GET /drills, the picker's read (the first page; a personal library is small).
 * - predictionPromptQuery: GET /prediction/{session}/next keyed by the session and a local cursor
 *   that moves on every Next and every stale-state recovery. The route is pure (O-302), so the
 *   cached prompt is the server's prompt for as long as the cursor stands.
 * - startPredictionSession and answerPrediction: the two POSTs, each with AUTO_CSRF_HEADER (the
 *   csrf fetch fills the token, O-197) and the caller's Idempotency-Key (O-232).
 */
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, problemFromBody, type AppApi } from "../api/index.js";
import type { PracticeSession, PredictionPrompt, PredictionResult } from "../contracts.js";
import { IDEMPOTENCY_HEADER } from "../trainer/idempotency.js";
import type { Drill } from "../trainer/session-types.js";
import type { PredictionAnswerBody } from "./types.js";

export const PREDICTION_QUERY_ROOT = "prediction";
/** The picker's drill list rarely changes while the page is open. */
const DRILLS_STALE_MS = 60 * 1000;
/** Drills the picker lists; the api's page limit allows up to 200. */
const DRILL_PAGE_LIMIT = 100;

export function drillListQuery(api: AppApi) {
  return queryOptions({
    queryKey: [PREDICTION_QUERY_ROOT, "drills"] as const,
    queryFn: async (): Promise<Drill[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/drills", { params: { query: { limit: DRILL_PAGE_LIMIT } } });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: DRILLS_STALE_MS,
    retry: false,
  });
}

export function predictionPromptQuery(api: AppApi, sessionId: string, cursor: number) {
  return queryOptions({
    queryKey: [PREDICTION_QUERY_ROOT, "next", sessionId, cursor] as const,
    queryFn: async (): Promise<PredictionPrompt> => {
      const { data, error, response } = await api.client.GET("/api/v1/prediction/{session}/next", {
        params: { path: { session: sessionId } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });
}

export interface StartPredictionInput {
  drillId: string;
  seed: string | undefined;
  key: string;
}

export async function startPredictionSession(api: AppApi, { drillId, seed, key }: StartPredictionInput): Promise<PracticeSession> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions", {
    params: { header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: { mode: "prediction", drill_id: drillId, ...(seed === undefined ? {} : { seed }) },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export async function answerPrediction(api: AppApi, sessionId: string, body: PredictionAnswerBody, key: string): Promise<PredictionResult> {
  const { data, error, response } = await api.client.POST("/api/v1/prediction/{session}/answer", {
    params: { path: { session: sessionId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body,
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}
