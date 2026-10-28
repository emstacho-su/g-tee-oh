/**
 * Admin invite routes (S42, R3.5, R3.1, O-349, O-420, O-423, O-427, O-428): POST /admin/invites,
 * GET /admin/invites and POST /admin/invites/{id}/revoke.
 *
 * Mechanism: like routes/admin.ts, an onRequest hook scoped to this plugin runs after the app's
 * authentication and CSRF (cross-site request forgery) hooks and requires app_user.is_admin
 * (requireAdmin: 401 without a session, 403 for a member), so no route here can forget the check.
 * Create keeps the default CSRF token check, has its own per-IP limit (O-428) and opts out of
 * Idempotency-Key (O-427): its response holds the only copy of the link, and a stored replay
 * would put that link in idempotency_key. A double submit therefore makes two invites, and the
 * second revokes the first (O-423), so one link works. The create, its revoke of an older pending
 * invite and the insert run in one transaction. The link is APP_ORIGIN/join#<token>: the fragment
 * never reaches a server, a log or a Referer header. Revoke accepts an Idempotency-Key and runs
 * through idempotentWrite. The list is cursor-paged, newest first, and carries no secret.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAdmin } from "../admin/require-admin.js";
import { formatInviteToken } from "../auth/invite-token.js";
import { createInvite, listInvites, revokeInvite, toInviteSummary } from "../auth/invites.js";
import { decodeCursor, paginate } from "../http/cursor.js";
import { requireDatabase } from "../http/database.js";
import { csrfOnlyHeadersSchema, mutatingHeadersSchema } from "../http/headers.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { ADMIN_MUTATE_PROBLEMS, ADMIN_READ_PROBLEMS, AUTHENTICATED } from "../http/openapi.js";
import { pageQuerySchema, pageSchema } from "../http/pagination.js";
import { HTTP_STATUS, problemResponses } from "../http/problem.js";
import { INVITE_CREATE_RATE_LIMIT } from "../http/rate-limits.js";
import { emptyBodySchema, idParamsSchema, uuidSchema } from "../schemas/common.js";
import { createdInviteSchema, createInviteBodySchema, inviteSummarySchema } from "../schemas/invites.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "admin";
export const JOIN_PATH = "/join";
const INVITE_LIST_CURSOR = z.strictObject({ id: uuidSchema });
const ADMIN_LIST_PROBLEMS = [400, ...ADMIN_READ_PROBLEMS] as const;
const ADMIN_REVOKE_PROBLEMS = [...ADMIN_MUTATE_PROBLEMS, 404] as const;

export function inviteLink(appOrigin: string, inviteId: string, secret: string): string {
  return `${appOrigin}${JOIN_PATH}#${formatInviteToken(inviteId, secret)}`;
}

export const adminInviteRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, options, done) => {
  const { appOrigin } = options.config;

  app.addHook("onRequest", (request, _reply, done) => {
    try {
      requireAdmin(request);
      done();
    } catch (error: unknown) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  });

  app.post(
    "/admin/invites",
    {
      config: { idempotent: false, rateLimit: INVITE_CREATE_RATE_LIMIT },
      schema: {
        tags: [TAG],
        summary: "Create an invite and answer its join link, once (O-349, O-427)",
        security: AUTHENTICATED,
        headers: csrfOnlyHeadersSchema,
        body: createInviteBodySchema,
        response: { 201: createdInviteSchema, ...problemResponses(ADMIN_MUTATE_PROBLEMS) },
      },
    },
    async (request, reply) => {
      const admin = requireAdmin(request);
      const now = new Date();
      const created = await requireDatabase(app)
        .transaction()
        .execute((transaction) => createInvite(transaction, request.body.email, admin.userId, now));
      return reply.code(HTTP_STATUS.created).send({
        invite: created.summary,
        link: inviteLink(appOrigin, created.summary.id, created.secret),
      });
    },
  );

  app.get(
    "/admin/invites",
    {
      schema: {
        tags: [TAG],
        summary: "Invites, newest first, with their computed status; never a link",
        security: AUTHENTICATED,
        querystring: pageQuerySchema,
        response: { 200: pageSchema(inviteSummarySchema), ...problemResponses(ADMIN_LIST_PROBLEMS) },
      },
    },
    async (request) => {
      const { cursor, limit } = request.query;
      const afterId = cursor === undefined ? undefined : decodeCursor(cursor, INVITE_LIST_CURSOR).id;
      const rows = await listInvites(requireDatabase(app), limit, afterId);
      const now = new Date();
      const page = paginate(rows, limit, (row) => ({ id: row.id }));
      return { items: page.items.map((row) => toInviteSummary(row, now)), next_cursor: page.next_cursor };
    },
  );

  app.post(
    "/admin/invites/:id/revoke",
    {
      schema: {
        tags: [TAG],
        summary: "Revoke an invite that is not used yet; revoking again answers the same",
        security: AUTHENTICATED,
        headers: mutatingHeadersSchema,
        params: idParamsSchema,
        body: emptyBodySchema,
        response: { 200: inviteSummarySchema, ...problemResponses(ADMIN_REVOKE_PROBLEMS) },
      },
    },
    async (request) =>
      idempotentWrite(app, request, HTTP_STATUS.ok, (transaction) =>
        revokeInvite(transaction, request.params.id, new Date()),
      ),
  );

  done();
};
