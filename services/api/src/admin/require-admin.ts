/**
 * Admin authorization (R3.5, O-242). The builder and invite endpoints are for an admin only: app_user.is_admin,
 * set by create-user --admin. The flag comes from the session lookup, which joins app_user on
 * every request (plugins/authenticate.ts, O-290), so revoking it takes effect on the next request
 * without a second query here (PR #28 review L6).
 */
import type { FastifyRequest } from "fastify";

import type { SessionContext } from "../auth/session-context.js";
import type { Database } from "../db.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";

/**
 * Whether the user may use the admin endpoints, read from app_user; an unknown user is not an
 * admin. The event stream route reads it at stream open (O-243); admin routes use requireAdmin.
 */
export async function isAdmin(database: Database, userId: string): Promise<boolean> {
  const row = await database.selectFrom("app_user").select("is_admin").where("id", "=", userId).executeTakeFirst();
  return row?.is_admin === true;
}

/** The session of an admin; a 401 problem without a session, a 403 forbidden problem otherwise. */
export function requireAdmin(request: FastifyRequest): SessionContext {
  const session = requireSession(request);
  if (!session.isAdmin) {
    throw new ProblemError(HTTP_STATUS.forbidden, PROBLEM_SLUGS.forbidden, {
      detail: "Only an admin may use the admin endpoints.",
    });
  }
  return session;
}
