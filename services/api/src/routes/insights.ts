/**
 * Insight card routes (R3.18, 05 section 9, O-304): GET /insights/drift answers range drift for one
 * node family (Rust's spot_class_key) over the session user's own attempts: the user's action-kind
 * shares against the solver's frequencies on the same decisions, as a distance with a confidence
 * interval, shown only from 30 decisions. It reads attempts and writes nothing, so drift never
 * changes a score or a rated flag. The handler lives in insights/.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { requireDatabase } from "../http/database.js";
import { AUTHENTICATED, READ_PROBLEMS } from "../http/openapi.js";
import { problemResponses } from "../http/problem.js";
import { driftFor } from "../insights/drift.js";
import { requireSession } from "../plugins/authenticate.js";
import { driftQuerySchema, driftSchema } from "../schemas/explain.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "insights";

export const insightRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, _options, done) => {
  app.get(
    "/insights/drift",
    {
      config: { owner: "S27 lane C" },
      schema: {
        tags: [TAG],
        summary: "Range drift for one node family, shown only from 30 decisions and never graded (R3.18, O-304)",
        security: AUTHENTICATED,
        querystring: driftQuerySchema,
        response: { 200: driftSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      return driftFor(requireDatabase(app), userId, request.query.spot_class_key);
    },
  );

  done();
};
