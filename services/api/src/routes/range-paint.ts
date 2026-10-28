/**
 * Range painting routes (R3.17, A5 section 3, 05 section 8, O-300, O-302): GET
 * /range-paint/{session}/next and POST /range-paint/submit over a drill-backed range_paint session.
 * The contract is settled by S27's first commit; the handlers live in range-paint/.
 *
 * GET next is pure (the node to paint is derived from the session seed and counter). POST submit
 * takes the CSRF token and an optional Idempotency-Key, relays solver-query's POST /v1/grade-range
 * numbers unchanged (ADR 0004) and advances the counter in one idempotent write; it writes no
 * attempt row (unrated).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import { notImplemented } from "../http/not-implemented.js";
import { AUTHENTICATED, UPSTREAM_MUTATE_PROBLEMS, UPSTREAM_READ_PROBLEMS } from "../http/openapi.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
import {
  rangePaintBodySchema,
  rangePaintParamsSchema,
  rangePaintPromptSchema,
  rangePaintResultSchema,
} from "../schemas/range-paint.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "prediction";

/** GET next also answers 409 for an ended session or a session of another mode (O-302). */
const NEXT_PROBLEMS = [...UPSTREAM_READ_PROBLEMS, HTTP_STATUS.conflict] as const;

export const rangePaintRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  app.get(
    "/range-paint/:session/next",
    {
      config: { owner: "S27 lane B" },
      schema: {
        tags: [TAG],
        summary: "The next node to paint",
        description: "Derived from the session seed and its counter; writes nothing (O-302).",
        security: AUTHENTICATED,
        params: rangePaintParamsSchema,
        response: { 200: rangePaintPromptSchema, ...problemResponses(NEXT_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.post(
    "/range-paint/submit",
    {
      config: { owner: "S27 lane B" },
      schema: {
        tags: [TAG],
        summary: "Submit a painted range for grading by reach-weighted EV loss; unrated (R3.17)",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: rangePaintBodySchema,
        response: { 200: rangePaintResultSchema, ...problemResponses(UPSTREAM_MUTATE_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  done();
};
