/**
 * Explanation and insight routes (R3.18, R3.19, R3.20, A5 section 3, A6 section 5, ADR 0016):
 * GET /explain/{attempt_id}/more-info (deterministic templates), GET /explain/status (the Ask
 * button's state: flag and monthly cap, O-305, O-306), POST /explain/{attempt_id}/ask (the model,
 * behind the flag, cached, capped and validated, O-305 to O-308); range drift is in
 * routes/insights.ts. The contract is settled by S27's first commit; the handlers live in explain/.
 *
 * Every route reads only the session user's own attempts (ADR 0001); another user's attempt is a
 * 404. Ask takes the CSRF token, an optional Idempotency-Key and a per-user rate limit.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import { notImplemented } from "../http/not-implemented.js";
import { AUTHENTICATED, READ_PROBLEMS, UPSTREAM_MUTATE_PROBLEMS, UPSTREAM_READ_PROBLEMS } from "../http/openapi.js";
import { problemResponses } from "../http/problem.js";
import {
  askBodySchema,
  askResultSchema,
  askStatusSchema,
  attemptParamsSchema,
  moreInfoSchema,
} from "../schemas/explain.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const EXPLAIN_TAG = "explain";

export const explainRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  app.get(
    "/explain/:attempt_id/more-info",
    {
      config: { owner: "S27 lane D" },
      schema: {
        tags: [EXPLAIN_TAG],
        summary: "The templated explanation of an attempt (R3.19)",
        security: AUTHENTICATED,
        params: attemptParamsSchema,
        response: { 200: moreInfoSchema, ...problemResponses(UPSTREAM_READ_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/explain/status",
    {
      config: { owner: "S27 lane D" },
      schema: {
        tags: [EXPLAIN_TAG],
        summary: "Whether Ask is available: the feature flag and this month's spend against the cap (O-305, O-306)",
        security: AUTHENTICATED,
        response: { 200: askStatusSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.post(
    "/explain/:attempt_id/ask",
    {
      config: { owner: "S27 lane D" },
      schema: {
        tags: [EXPLAIN_TAG],
        summary: "Ask the model about an attempt, behind a feature flag and a monthly cap (R3.20, O-54)",
        description:
          "503 ask-disabled while the flag is off; 429 ask-cap-reached above the monthly cap; a cache hit spends nothing (O-305 to O-307).",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: attemptParamsSchema,
        body: askBodySchema,
        response: { 200: askResultSchema, ...problemResponses(UPSTREAM_MUTATE_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  done();
};
