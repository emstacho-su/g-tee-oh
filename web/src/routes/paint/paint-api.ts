/**
 * The /paint screen's api calls (S27 lane B, R3.17, O-197, O-232, O-302). Each wraps one typed
 * client call; a response without data becomes an ApiProblem through problemFromBody, so callers
 * see the status and slug, never the raw body.
 *
 * The picker's drill list is the shared practice/drill-list-query.ts read (PR #29 review L11).
 * - createPaintSession: POST /sessions with mode range_paint and the drill (O-302).
 * - paintPromptQuery: GET /range-paint/{session}/next keyed by the session and the state version
 *   the prompt follows. next is pure, so the cached prompt never goes stale for its version.
 * - submitPaint: POST /range-paint/submit with the painted map.
 * The POSTs carry AUTO_CSRF_HEADER (the csrf fetch fills the token, O-197) and an Idempotency-Key
 * (O-232). paintFailureText maps a failure to a fixed sentence; a problem's detail is never shown.
 */
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, HTTP_STATUS, isApiProblem, problemFromBody } from "../../api/index.js";
import type { AppApi } from "../../api/index.js";
import type { RangePaintPrompt, RangePaintResult } from "../../contracts.js";
import { IDEMPOTENCY_HEADER } from "../../trainer/idempotency.js";
import type { PracticeSession } from "../../trainer/session-types.js";

export const PAINT_QUERY_ROOT = "paint";
const PROMPT_GC_MS = 60 * 1000;
const RANGE_PAINT_MODE = "range_paint";

export interface StartPaintInput {
  drillId: string;
  seed: string | undefined;
  key: string;
}

export async function createPaintSession(api: AppApi, { drillId, seed, key }: StartPaintInput): Promise<PracticeSession> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions", {
    params: { header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: { mode: RANGE_PAINT_MODE, drill_id: drillId, ...(seed === undefined ? {} : { seed }) },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export function paintPromptQuery(api: AppApi, sessionId: string, stateVersion: number) {
  return queryOptions({
    queryKey: [PAINT_QUERY_ROOT, "next", sessionId, stateVersion] as const,
    queryFn: async (): Promise<RangePaintPrompt> => {
      const { data, error, response } = await api.client.GET("/api/v1/range-paint/{session}/next", { params: { path: { session: sessionId } } });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: Infinity,
    gcTime: PROMPT_GC_MS,
    retry: false,
  });
}

export interface SubmitPaintInput {
  prompt: Pick<RangePaintPrompt, "session_id" | "state_version" | "node_key">;
  paint: Record<string, number>;
  key: string;
}

export async function submitPaint(api: AppApi, { prompt, paint, key }: SubmitPaintInput): Promise<RangePaintResult> {
  const { data, error, response } = await api.client.POST("/api/v1/range-paint/submit", {
    params: { header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: { session_id: prompt.session_id, state_version: prompt.state_version, node_key: prompt.node_key, paint },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

const STALE_SLUG = "stale-state";
const NO_COVERAGE_SLUG = "no-coverage";

export const PAINT_FAILURES = {
  stale: "This range moved on since it was loaded. Load the current range and paint it again.",
  noCoverage: "The library covers no spot this drill trains, so there is no range to paint. Pick another drill.",
  notFound: "This drill or session no longer exists. Pick a drill again.",
  upstream: "The solver service could not answer. Try again in a moment.",
  generic: "Something went wrong. Try again.",
} as const;

/** A fixed sentence for a failure; the problem's own text is never shown. */
export function paintFailureText(error: unknown): string {
  if (!isApiProblem(error)) return PAINT_FAILURES.generic;
  if (error.status === HTTP_STATUS.conflict && error.slug === STALE_SLUG) return PAINT_FAILURES.stale;
  if (error.slug === NO_COVERAGE_SLUG) return PAINT_FAILURES.noCoverage;
  if (error.status === HTTP_STATUS.notFound) return PAINT_FAILURES.notFound;
  if (error.status === HTTP_STATUS.badGateway || error.status === HTTP_STATUS.unavailable) return PAINT_FAILURES.upstream;
  return PAINT_FAILURES.generic;
}

export function isStalePaint(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.conflict && error.slug === STALE_SLUG;
}
