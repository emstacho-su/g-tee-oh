/**
 * Catalog routes (R3.2, A5 section 3, ADR 0014): GET /stakes, GET /configs, GET /configs/{id}/pairs
 * over the seeded catalog (R0.6). Configurations are keyed by config_id, which names the stake, so
 * a 1/3 and a 2/5 configuration with the same table size and depth never share a key (criterion
 * 11, R2.2).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { notImplemented } from "../http/not-implemented.js";
import { AUTHENTICATED, READ_ONE_PROBLEMS, READ_PROBLEMS } from "../http/openapi.js";
import { problemResponses } from "../http/problem.js";
import {
  configPageSchema,
  configsQuerySchema,
  pairPageSchema,
  pairsQuerySchema,
  stakePageSchema,
  stakesQuerySchema,
} from "../schemas/catalog.js";
import { configIdParamsSchema } from "../schemas/common.js";

const TAG = "catalog";

export const catalogRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    "/stakes",
    {
      schema: {
        tags: [TAG],
        summary: "Stakes with their rake terms (ADR 0014)",
        security: AUTHENTICATED,
        querystring: stakesQuerySchema,
        response: { 200: stakePageSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/configs",
    {
      schema: {
        tags: [TAG],
        summary: "Game configurations, each keyed by config_id with its stake",
        security: AUTHENTICATED,
        querystring: configsQuerySchema,
        response: { 200: configPageSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/configs/:id/pairs",
    {
      schema: {
        tags: [TAG],
        summary: "Position pairs seated at a configuration, with preflop availability (O-234)",
        security: AUTHENTICATED,
        params: configIdParamsSchema,
        querystring: pairsQuerySchema,
        response: { 200: pairPageSchema, ...problemResponses(READ_ONE_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  done();
};
