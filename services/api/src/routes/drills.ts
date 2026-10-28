/**
 * Drill CRUD routes (R3.14, A5 section 3): GET /drills, GET /drills/{id}, POST /drills,
 * PATCH /drills/{id}, DELETE /drills/{id}, every one scoped to the session user (ADR 0001), plus
 * GET /drills/{id}/export and POST /drills/import over g-tee-oh's export code (S26, O-310,
 * drills/export-code.ts). Import decodes the code before any write and then creates a new drill
 * exactly as POST /drills does; it never overwrites one.
 *
 * Mechanism: the user id comes from the session (requireSession), never from the request, and
 * every query in drills/repository.ts filters by it, so another user's drill is a 404 problem,
 * never a 403. The list is newest first by uuidv7 id with an opaque id cursor (http/cursor.ts).
 * PATCH sets only the fields the body carries and moves updated_at. A DELETE that a
 * practice_session still references answers a 409 conflict problem rather than a 500. POST, PATCH
 * and DELETE write through idempotentWrite, so under an Idempotency-Key the stored response
 * commits with the write and a retry can never write twice (O-232).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { mutatingHeadersSchema } from "../http/headers.js";
import {
  checkExportable,
  decodeExportCode,
  encodeExportCode,
  ExportCodeError,
  type ExportCodeIssue,
} from "../drills/export-code.js";
import { toDrill } from "../drills/mapper.js";
import { deleteDrill, findDrill, insertDrill, listDrills, updateDrill } from "../drills/repository.js";
import { decodeCursor, paginate } from "../http/cursor.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { AUTHENTICATED, MUTATE_ONE_PROBLEMS, MUTATE_PROBLEMS, READ_ONE_PROBLEMS, READ_PROBLEMS } from "../http/openapi.js";
import { PROBLEM_SLUGS, ProblemError, problemResponses, HTTP_STATUS, type ProblemFieldError } from "../http/problem.js";
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
  type DrillCreateBody,
} from "../schemas/drills.js";

const TAG = "drills";

const drillCursorSchema = z.strictObject({ id: uuidSchema });

function drillNotFound(): ProblemError {
  return new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No drill of yours has this id." });
}

const EXPORT_CODE_FIELD = "body.export_code";

/** Issues under a field path; "" is the field itself. */
function fieldErrorsAt(field: string, issues: readonly ExportCodeIssue[]): ProblemFieldError[] {
  return issues.map((issue) => ({ path: issue.path === "" ? field : `${field}.${issue.path}`, message: issue.message }));
}

/** The drill an export code holds, or a 400 validation problem pointing at body.export_code. */
function decodeOrProblem(code: string): DrillCreateBody {
  try {
    return decodeExportCode(code);
  } catch (error: unknown) {
    if (!(error instanceof ExportCodeError)) {
      throw error;
    }
    const fieldErrors =
      error.issues.length === 0 ? [{ path: EXPORT_CODE_FIELD, message: error.message }] : fieldErrorsAt(EXPORT_CODE_FIELD, error.issues);
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.validation, {
      detail: error.message,
      errors: fieldErrors,
      errorsOmitted: error.omitted,
    });
  }
}

const STORED_DRILL_FIELD = "drill";

/**
 * The stored drill as today's write rules accept it, or a 422 validation problem naming the first
 * rule it breaks (MEDIUM 2): export never hands out a code its own import would refuse.
 */
function exportableOrProblem(drill: DrillCreateBody): DrillCreateBody {
  const check = checkExportable(drill);
  if (check.ok) {
    return check.drill;
  }
  const errors = fieldErrorsAt(STORED_DRILL_FIELD, check.issues);
  const first = errors[0];
  const rule = first === undefined ? "it breaks a write rule" : `${first.path}: ${first.message}`;
  throw new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.validation, {
    detail: `This drill can no longer be exported: ${rule}. Edit the drill so it meets the rule, then export it again.`,
    errors,
    errorsOmitted: check.omitted,
  });
}

/** GET /drills/{id}/export also answers 422 for a stored drill the write rules now refuse. */
const EXPORT_PROBLEMS = [...READ_ONE_PROBLEMS, HTTP_STATUS.unprocessable] as const;

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
      const drill = await idempotentWrite(app, request, HTTP_STATUS.created, async (transaction) =>
        toDrill(await insertDrill(transaction, userId, request.body)),
      );
      return reply.code(HTTP_STATUS.created).send(drill);
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
      return idempotentWrite(app, request, HTTP_STATUS.ok, async (transaction) => {
        const row = await updateDrill(transaction, userId, request.params.id, request.body);
        if (row === undefined) {
          throw drillNotFound();
        }
        return toDrill(row);
      });
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
      await idempotentWrite(app, request, HTTP_STATUS.noContent, async (transaction) => {
        const outcome = await deleteDrill(transaction, userId, request.params.id);
        if (outcome === "not_found") {
          throw drillNotFound();
        }
        if (outcome === "in_use") {
          throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.conflict, {
            detail: "A practice session still references this drill.",
          });
        }
        return null;
      });
      return reply.code(HTTP_STATUS.noContent).send(null);
    },
  );

  app.post(
    "/drills/import",
    {
      schema: {
        tags: [TAG],
        summary: "Import a drill from its export code",
        description:
          "Creates a new drill of the session user from an export code (O-310); never overwrites a drill. " +
          "A code that is too long, of another version, damaged, expanding past its cap or holding a drill " +
          "the write rules refuse is a 400 validation problem pointing at body.export_code.",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        body: drillImportBodySchema,
        response: { 201: drillSchema, ...problemResponses(MUTATE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      // Decoded before the write, so a refused code never opens a transaction. Under an
      // Idempotency-Key the key was already claimed in the preHandler (plugins/idempotency.ts),
      // and onSend stores the refusal's 400, so a retry with the same key replays that 400.
      const body = decodeOrProblem(request.body.export_code);
      const drill = await idempotentWrite(app, request, HTTP_STATUS.created, async (transaction) =>
        toDrill(await insertDrill(transaction, userId, body)),
      );
      return reply.code(HTTP_STATUS.created).send(drill);
    },
  );

  app.get(
    "/drills/:id/export",
    {
      schema: {
        tags: [TAG],
        summary: "A drill's export code",
        description:
          "g-tee-oh's own encoding of the drill's name, tags, spot filter and trainer settings (O-310). " +
          "A stored drill that today's write rules refuse (written before a rule existed) is a 422 validation " +
          'problem whose detail starts with "This drill can no longer be exported:" and whose errors name the failing paths.',
        security: AUTHENTICATED,
        params: idParamsSchema,
        response: { 200: drillExportSchema, ...problemResponses(EXPORT_PROBLEMS) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const row = await findDrill(requireDatabase(app), userId, request.params.id);
      if (row === undefined) {
        throw drillNotFound();
      }
      const { name, tags, spot_filter, trainer } = toDrill(row);
      return { export_code: encodeExportCode(exportableOrProblem({ name, tags, spot_filter, trainer })) };
    },
  );

  done();
};
