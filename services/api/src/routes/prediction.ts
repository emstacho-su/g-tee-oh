/**
 * Prediction drill routes (R3.16, A5 section 3, 05 section 8, O-301, O-302): GET
 * /prediction/{session}/next and POST /prediction/{session}/answer over a drill-backed prediction
 * session. The contract is settled by S27's first commit; the handlers live in prediction/.
 *
 * GET next is pure: the prompt is derived from the session seed and its answered counter, so a
 * repeat answers the same prompt and no strategy number leaves the server before the answer. POST
 * answer takes the CSRF token and an optional Idempotency-Key (route-config.ts defaults), records
 * one unrated prediction_answer row and advances the counter in one idempotent write; it never
 * writes an attempt row or touches rating state.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import { AUTHENTICATED, UPSTREAM_MUTATE_PROBLEMS, UPSTREAM_READ_PROBLEMS } from "../http/openapi.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import { answerPrediction, nextPrediction } from "../prediction/service.js";
import {
  predictionAnswerBodySchema,
  predictionParamsSchema,
  predictionPromptSchema,
  predictionResultSchema,
} from "../schemas/prediction.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "prediction";

/**
 * GET next also answers 409 for an ended session or a session of another mode (O-302), and 422
 * no-quiz-questions when a quiz's spots can no longer ask its level on its kinds (O-411 amended).
 */
const NEXT_PROBLEMS = [...UPSTREAM_READ_PROBLEMS, HTTP_STATUS.conflict, HTTP_STATUS.unprocessable] as const;

export const predictionRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  app.get(
    "/prediction/:session/next",
    {
      config: { owner: "S27 lane A" },
      schema: {
        tags: [TAG],
        summary: "The next prediction prompt",
        description: "Derived from the session seed and its answered counter; writes nothing (O-302).",
        security: AUTHENTICATED,
        params: predictionParamsSchema,
        response: { 200: predictionPromptSchema, ...problemResponses(NEXT_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      return nextPrediction({ app, request, userId }, request.params.session);
    },
  );

  app.post(
    "/prediction/:session/answer",
    {
      config: { owner: "S27 lane A" },
      schema: {
        tags: [TAG],
        summary: "Answer a prediction prompt; unrated, no attempt row (R3.16)",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: predictionParamsSchema,
        body: predictionAnswerBodySchema,
        response: { 200: predictionResultSchema, ...problemResponses(UPSTREAM_MUTATE_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      return answerPrediction({ app, request, userId }, request.params.session, request.body);
    },
  );

  done();
};
