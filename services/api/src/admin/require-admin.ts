/**
 * Admin authorization (R3.5, O-242). The builder endpoints are for an admin only: app_user.is_admin,
 * set by create-user --admin. The flag is read from the database on every request rather than
 * cached on the session, so revoking it takes effect at once.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { SessionContext } from "../auth/session-context.js";
import type { Database } from "../db.js";
import { requireDatabase } from "../http/database.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";

/** Whether the user may use the admin endpoints; an unknown user is not an admin. */
export async function isAdmin(database: Database, userId: string): Promise<boolean> {
  const row = await database.selectFrom("app_user").select("is_admin").where("id", "=", userId).executeTakeFirst();
  return row?.is_admin === true;
}

/** The session of an admin; a 401 problem without a session, a 403 forbidden problem otherwise. */
export async function requireAdmin(app: FastifyInstance, request: FastifyRequest): Promise<SessionContext> {
  const session = requireSession(request);
  if (!(await isAdmin(requireDatabase(app), session.userId))) {
    throw new ProblemError(HTTP_STATUS.forbidden, PROBLEM_SLUGS.forbidden, {
      detail: "Only an admin may use the builder endpoints.",
    });
  }
  return session;
}
