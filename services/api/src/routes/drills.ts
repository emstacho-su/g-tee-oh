/**
 * Drill CRUD routes (R3.14, A5 section 3): GET /drills, GET /drills/{id}, POST /drills,
 * PATCH /drills/{id}, DELETE /drills/{id}, every one scoped to the session user (ADR 0001), plus
 * the import and export routes S26 builds (501 until then, O-38).
 *
 * Mechanism: the user id comes from the session (requireSession), never from the request, and
 * every query in drills/repository.ts filters by it, so another user's drill is a 404 problem,
 * never a 403. The list is newest first by uuidv7 id with an opaque id cursor (http/cursor.ts).
 * PATCH sets only the fields the body carries and moves updated_at. A DELETE that a
 * practice_session still references answers a 409 conflict problem rather than a 500.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import { toDrill } from "../drills/mapper.js";
import { deleteDrill, findDrill, insertDrill, listDrills, updateDrill } from "../drills/repository.js";
import { decodeCursor, paginate } from "../http/cursor.js";
import { requireDatabase } from "../http/database.js";
import { notImplemented, plannedDescription } from "../http/not-implemented.js";
import {
  AUTHENTICATED,
  MUTATE_ONE_PROBLEMS,
  MUTATE_PROBLEMS,
  PLANNED_MUTATE_PROBLEMS,
  PLANNED_READ_PROBLEMS,
  READ_ONE_PROBLEMS,
  READ_PROBLEMS,
} from "../http/openapi.js";
import { PROBLEM_SLUGS, ProblemError, problemResponses } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";
import { idParamsSchema, uuidSchema } from "../schemas/common.js";
import {
  drillCreateBodySchema,
  drillExportSchema,
  drillImportBodySchema,
  drillPageSchema,
  drillPatchBodySchema,
  drillSchema,
  drillsQuerySchema,
} from "../schemas/drills.js";

const TAG = "drills";
const DRILLS_OWNER = "S26";
const CREATED_STATUS = 201;
const NO_CONTENT_STATUS = 204;
const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;

const drillCursorSchema = z.strictObject({ id: uuidSchema });

function drillNotFound(): ProblemError {
  return new ProblemError(NOT_FOUND_STATUS, PROBLEM_SLUGS.notFound, { detail: "No drill of yours has this id." });
}

export const drillRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    "/drills",
    {
      schema: {
        tags: [TAG],
        summary: "The session user's drills, newest first",
        security: AUTHENTICATED,
        querystring: drillsQuerySchema,
        response: { 200: drillPageSchema, ...problemResponses(READ_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const { cursor, limit, tag } = request.query;
      const before = cursor === undefined ? undefined : decodeCursor(cursor, drillCursorSchema);
      const rows = await listDrills(requireDatabase(app), userId, { tag, beforeId: before?.id, fetch: limit + 1 });
      const page = paginate(rows, limit, (row) => ({ id: row.id }));
      return { items: page.items.map(toDrill), next_cursor: page.next_cursor };
    },
  );

  app.get(
    "/drills/:id",
    {
      schema: {
        tags: [TAG],
        summary: "One drill",
        security: AUTHENTICATED,
        params: idParamsSchema,
        response: { 200: drillSchema, ...problemResponses(READ_ONE_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const row = await findDrill(requireDatabase(app), userId, request.params.id);
      if (row === undefined) {
        throw drillNotFound();
      }
      return toDrill(row);
    },
  );

  app.post(
    "/drills",
    {
      schema: {
        tags: [TAG],
        summary: "Create a drill",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: drillCreateBodySchema,
        response: { 201: drillSchema, ...problemResponses(MUTATE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const row = await insertDrill(requireDatabase(app), userId, request.body);
      return reply.code(CREATED_STATUS).send(toDrill(row));
    },
  );

  app.patch(
    "/drills/:id",
    {
      schema: {
        tags: [TAG],
        summary: "Change a drill's name, tags, spot filter or trainer settings",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: idParamsSchema,
        body: drillPatchBodySchema,
        response: { 200: drillSchema, ...problemResponses(MUTATE_ONE_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const row = await updateDrill(requireDatabase(app), userId, request.params.id, request.body);
      if (row === undefined) {
        throw drillNotFound();
      }
      return toDrill(row);
    },
  );

  app.delete(
    "/drills/:id",
    {
      schema: {
        tags: [TAG],
        summary: "Delete a drill",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: idParamsSchema,
        response: { 204: z.null().describe("Deleted"), ...problemResponses(MUTATE_ONE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const outcome = await deleteDrill(requireDatabase(app), userId, request.params.id);
      if (outcome === "not_found") {
        throw drillNotFound();
      }
      if (outcome === "in_use") {
        throw new ProblemError(CONFLICT_STATUS, PROBLEM_SLUGS.conflict, {
          detail: "A practice session still references this drill.",
        });
      }
      return reply.code(NO_CONTENT_STATUS).send(null);
    },
  );

  app.post(
    "/drills/import",
    {
      config: { owner: DRILLS_OWNER },
      schema: {
        tags: [TAG],
        summary: "Import a drill from its export code",
        description: plannedDescription(DRILLS_OWNER, "Creates a drill from an export code."),
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: drillImportBodySchema,
        response: { 201: drillSchema, ...problemResponses(PLANNED_MUTATE_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  app.get(
    "/drills/:id/export",
    {
      config: { owner: DRILLS_OWNER },
      schema: {
        tags: [TAG],
        summary: "A drill's export code",
        description: plannedDescription(DRILLS_OWNER, "g-tee-oh's own encoding of the drill."),
        security: AUTHENTICATED,
        params: idParamsSchema,
        response: { 200: drillExportSchema, ...problemResponses(PLANNED_READ_PROBLEMS) },
      },
    },
    (request) => notImplemented(request),
  );

  done();
};
