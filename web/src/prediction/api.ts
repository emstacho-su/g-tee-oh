/**
 * The quiz's api calls (S27 lane A, S41, R3.16, A5 section 3, O-197, O-232, O-302, O-415). Each
 * wraps one typed client call; a response without data becomes an ApiProblem through
 * problemFromBody, so callers see the status and slug and never the raw body or its detail.
 *
 * - predictionPromptQuery: GET /prediction/{session}/next keyed by the session and a local cursor
 *   that moves on every Next and every stale-state recovery. The route is pure (O-302), so the
 *   cached prompt is the server's prompt for as long as the cursor stands.
 * - startPredictionSession: POST /sessions with mode prediction, either over a drill (an old link,
 *   no quiz options) or over a catalog spot with the quiz's difficulty and question kinds (O-415).
 * - answerPrediction: the answer with its reason (O-412); its problem keeps the body's field
 *   errors (drills/problem.ts, bounded and narrowed), so a refused reason is recognisable.
 * - endPredictionSession: POST /sessions/{id}/end, when the player ends the quiz.
 * Every POST carries AUTO_CSRF_HEADER (the csrf fetch fills the token, O-197) and the caller's
 * Idempotency-Key (O-232).
 */
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, problemFromBody, type AppApi } from "../api/index.js";
import type { PracticeSession, PredictionPrompt, PredictionResult } from "../contracts.js";
import { drillProblemFromBody } from "../drills/problem.js";
import type { QuizChoice } from "../practice/quiz-search.js";
import type { SessionRecap } from "../progress/types.js";
import { IDEMPOTENCY_HEADER } from "../trainer/idempotency.js";
import type { PredictionAnswerBody } from "./types.js";

export const PREDICTION_QUERY_ROOT = "prediction";
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

/** What a quiz starts over: an old drill link, or the start screen's catalog choice. */
export type PredictionSource = { readonly kind: "drill"; readonly drillId: string } | { readonly kind: "quiz"; readonly choice: QuizChoice };

export interface StartPredictionInput {
  source: PredictionSource;
  seed: string | undefined;
  key: string;
}

function sourceBody(source: PredictionSource) {
  if (source.kind === "drill") return { drill_id: source.drillId };
  const { choice } = source;
  return {
    catalog_spot: { config_id: choice.config, hero_positions: [...choice.positions], spot_types: [...choice.spots] },
    quiz: { difficulty: choice.difficulty, question_kinds: [...choice.kinds] },
  };
}

export async function startPredictionSession(api: AppApi, { source, seed, key }: StartPredictionInput): Promise<PracticeSession> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions", {
    params: { header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: { mode: "prediction", ...sourceBody(source), ...(seed === undefined ? {} : { seed }) },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export async function answerPrediction(api: AppApi, sessionId: string, body: PredictionAnswerBody, key: string): Promise<PredictionResult> {
  const { data, error, response } = await api.client.POST("/api/v1/prediction/{session}/answer", {
    params: { path: { session: sessionId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body,
  });
  // The problem keeps its field errors, so a refused reason (body.rationale) can be told apart.
  if (data === undefined) throw drillProblemFromBody(response.status, error);
  return data;
}

export async function endPredictionSession(api: AppApi, sessionId: string, key: string): Promise<SessionRecap> {
  const { data, error, response } = await api.client.POST("/api/v1/sessions/{id}/end", {
    params: { path: { id: sessionId }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: key } },
    body: {},
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}
