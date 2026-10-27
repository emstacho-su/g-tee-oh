/**
 * Session authentication (R3.1, A9 section 3, O-231). An onRequest hook reads the session cookie,
 * hashes it, and looks up a live auth_session row joined to its user. The result is set on
 * request.session; a route whose policy is auth "required" (the default, route-config.ts) answers
 * a 401 problem when there is none.
 *
 * Mechanism: the cookie carries 32 random bytes, the table only their sha256, so the lookup is by
 * hash. An expired row is deleted when it is met and treated as absent; sessions do not slide, so
 * a lookup never extends expires_at. A malformed cookie is treated as no cookie without touching
 * the database.
 */
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";

import type { SessionContext } from "../auth/session-context.js";
import { hashSessionToken, isWellFormedToken } from "../auth/tokens.js";
import type { Database } from "../db.js";
import { SESSION_COOKIE_NAME } from "../http/openapi.js";
import { PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { DEFAULT_AUTH_POLICY } from "../http/route-config.js";

const UNAUTHENTICATED_STATUS = 401;

/** Finds the live session for a cookie value; deletes the row if it has expired. */
export async function findLiveSession(
  database: Database,
  token: string,
  now: Date = new Date(),
): Promise<SessionContext | null> {
  if (!isWellFormedToken(token)) {
    return null;
  }
  const row = await database
    .selectFrom("auth_session")
    .innerJoin("app_user", "app_user.id", "auth_session.user_id")
    .select([
      "auth_session.id as session_id",
      "auth_session.user_id",
      "auth_session.csrf_token",
      "auth_session.expires_at",
      "app_user.email",
      "app_user.created_at as user_created_at",
    ])
    .where("auth_session.token_hash", "=", hashSessionToken(token))
    .executeTakeFirst();
  if (row === undefined) {
    return null;
  }
  if (row.expires_at.getTime() <= now.getTime()) {
    await database.deleteFrom("auth_session").where("id", "=", row.session_id).execute();
    return null;
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    userCreatedAt: row.user_created_at,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

/** The session of an authenticated route; the hook guarantees it, this narrows the type. */
export function requireSession(request: FastifyRequest): SessionContext {
  if (request.session === null) {
    throw new ProblemError(UNAUTHENTICATED_STATUS, PROBLEM_SLUGS.unauthenticated);
  }
  return request.session;
}

async function authenticationPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);
  app.decorateRequest("session", null);

  app.addHook("onRequest", async (request) => {
    request.session = null;
    // An unknown path answers the 404 problem whether or not the caller is logged in.
    if (request.is404) {
      return;
    }
    const policy = request.routeOptions.config.auth ?? DEFAULT_AUTH_POLICY;
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token !== undefined && app.database !== null) {
      request.session = await findLiveSession(app.database, token);
    }
    if (policy === "required" && request.session === null) {
      throw new ProblemError(UNAUTHENTICATED_STATUS, PROBLEM_SLUGS.unauthenticated);
    }
  });
}

/** Not encapsulated (fastify-plugin), so the hook applies to every route registered after it. */
export const authentication = fastifyPlugin(authenticationPlugin, { name: "g-tee-oh-authentication" });
