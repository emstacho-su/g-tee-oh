/**
 * Drill CRUD routes (R3.14, A5 section 3): GET /drills, GET /drills/{id}, POST /drills,
 * PATCH /drills/{id}, DELETE /drills/{id}, every one scoped to the session user (ADR 0001), plus
 * the import and export routes S26 builds (501 until then, O-38).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { mutatingHeadersSchema } from "../http/headers.js";
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
import { problemResponses } from "../http/problem.js";
import { idParamsSchema } from "../schemas/common.js";
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
    (request) => notImplemented(request),
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
    (request) => notImplemented(request),
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
    (request) => notImplemented(request),
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
    (request) => notImplemented(request),
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
    (request) => notImplemented(request),
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
