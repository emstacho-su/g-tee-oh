/**
 * Query options and the ask call for the explain controls (S27 lane D, R3.19, R3.20, O-305 to
 * O-308, A5 section 3), modelled on study/queries.ts.
 *
 * - askStatusQuery: GET /explain/status (the flag and this month's spend against the cap). The
 *   spend moves with every ask, so the status is never fresh: each feedback panel reads it again on
 *   mount, and the Ask dialog invalidates it after every answer or refusal.
 * - moreInfoQuery: GET /explain/{attempt_id}/more-info, the five template sections (O-309). They
 *   are deterministic over the attempt's solver data, so a read stays fresh for the page's life.
 * - askQuestion: POST /explain/{attempt_id}/ask with AUTO_CSRF_HEADER (the csrf fetch fills the
 *   token, O-197) and the caller's Idempotency-Key (O-232).
 * A response without data becomes an ApiProblem through problemFromBody, so callers see the status
 * and slug and never the raw body.
 */
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { AskResult } from "../contracts.js";
import { IDEMPOTENCY_HEADER } from "../trainer/idempotency.js";

export const EXPLAIN_QUERY_ROOT = "explain";
/** The status is read again on every mount: the spend changes with every ask (O-306). */
const ASK_STATUS_STALE_MS = 0;

export function askStatusKey() {
  return [EXPLAIN_QUERY_ROOT, "status"] as const;
}

export function askStatusQuery(api: AppApi) {
  return queryOptions({
    queryKey: askStatusKey(),
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/explain/status");
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: ASK_STATUS_STALE_MS,
    retry: false,
  });
}

export function moreInfoKey(attemptId: string) {
  return [EXPLAIN_QUERY_ROOT, "more-info", attemptId] as const;
}

export function moreInfoQuery(api: AppApi, attemptId: string) {
  return queryOptions({
    queryKey: moreInfoKey(attemptId),
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/explain/{attempt_id}/more-info", {
        params: { path: { attempt_id: attemptId } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });
}

export interface AskInput {
  attemptId: string;
  question: string;
  idempotencyKey: string;
}

export async function askQuestion(api: AppApi, { attemptId, question, idempotencyKey }: AskInput): Promise<AskResult> {
  const { data, error, response } = await api.client.POST("/api/v1/explain/{attempt_id}/ask", {
    params: { path: { attempt_id: attemptId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: idempotencyKey } },
    body: { question },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}
