/**
 * Catalog routes (R3.2, A5 section 3, ADR 0014): GET /stakes, GET /configs, GET /configs/{id}/pairs
 * over the seeded catalog (R0.6). Configurations are keyed by config_id, which names the stake, so
 * a 1/3 and a 2/5 configuration with the same table size and depth never share a key (criterion
 * 11, R2.2).
 *
 * Mechanism: each handler decodes its cursor with a Zod schema (a tampered cursor is a 400
 * problem), reads limit + 1 rows through catalog/repository.ts and lets paginate split off the
 * extra row. Pairs are not stored: they are generated from the configuration's table size by
 * catalog/seats.ts (O-234), flagged against the published preflop solutions, and paged over that
 * list with a cursor holding the last pair served.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { z } from "zod";

import { canonicalPairs } from "../catalog/seats.js";
import { findConfigSeating, listConfigs, listStakes, publishedPreflopPairs } from "../catalog/repository.js";
import { decodeCursor, paginate } from "../http/cursor.js";
import { requireDatabase } from "../http/database.js";
import { AUTHENTICATED, READ_ONE_PROBLEMS, READ_PROBLEMS } from "../http/openapi.js";
import { PROBLEM_SLUGS, ProblemError, problemResponses, HTTP_STATUS } from "../http/problem.js";
import {
  configPageSchema,
  configsQuerySchema,
  pairPageSchema,
  pairsQuerySchema,
  stakePageSchema,
  stakesQuerySchema,
} from "../schemas/catalog.js";
import { configIdParamsSchema, configIdSchema, uuidSchema } from "../schemas/common.js";

const TAG = "catalog";

const stakeCursorSchema = z.strictObject({ id: uuidSchema });
const configCursorSchema = z.strictObject({ id: configIdSchema });

/** A pairs cursor is valid only if it names a pair seated at this configuration's table size. */
function pairCursorSchema(pairs: readonly string[]) {
  return z.strictObject({ pair: z.string().refine((pair) => pairs.includes(pair)) });
}

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
    async (request) => {
      const { cursor, limit, format } = request.query;
      const after = cursor === undefined ? undefined : decodeCursor(cursor, stakeCursorSchema);
      const rows = await listStakes(requireDatabase(app), { format, afterId: after?.id, fetch: limit + 1 });
      return paginate(rows, limit, (row) => ({ id: row.id }));
    },
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
    async (request) => {
      const { cursor, limit, format, stake_id: stakeId, table_size: tableSize } = request.query;
      const after = cursor === undefined ? undefined : decodeCursor(cursor, configCursorSchema);
      const rows = await listConfigs(requireDatabase(app), {
        format,
        stakeId,
        tableSize,
        afterId: after?.id,
        fetch: limit + 1,
      });
      return paginate(rows, limit, (row) => ({ id: row.config_id }));
    },
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
    async (request) => {
      const database = requireDatabase(app);
      const { cursor, limit } = request.query;
      const config = await findConfigSeating(database, request.params.id);
      if (config === undefined) {
        throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No configuration has this id." });
      }
      const pairs = canonicalPairs(config.tableSize);
      const names = pairs.map((entry) => entry.pair);
      const start = cursor === undefined ? 0 : names.indexOf(decodeCursor(cursor, pairCursorSchema(names)).pair) + 1;
      const available = await publishedPreflopPairs(database, config.id);
      const entries = pairs
        .slice(start, start + limit + 1)
        .map((entry) => ({ ...entry, preflop_available: available.has(entry.pair) }));
      return { config_id: config.id, ...paginate(entries, limit, (entry) => ({ pair: entry.pair })) };
    },
  );

  done();
};
