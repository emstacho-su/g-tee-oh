/**
 * POST /sessions/{id}/end for a practice session (quiz or painting), with AUTO_CSRF_HEADER (O-197)
 * and the caller's Idempotency-Key (O-232). A response without data becomes an ApiProblem through
 * problemFromBody, so callers see the status and slug and never the raw body.
 */
import { AUTO_CSRF_HEADER, problemFromBody, type AppApi } from "../api/index.js";
import type { SessionRecap } from "../progress/types.js";
import { IDEMPOTENCY_HEADER } from "../trainer/idempotency.js";

export async function endPracticeSession(api: AppApi, sessionId: string, key: string): Promise<SessionRecap> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions/{id}/end", {
    params: { path: { id: sessionId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: {},
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}
