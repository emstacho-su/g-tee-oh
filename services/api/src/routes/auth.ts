/**
 * Auth routes (R3.1, A5 section 3, A9 section 3): POST /auth/login, POST /auth/logout, GET /me.
 * Login is the one public mutating route: no session yet, so its CSRF (cross-site request
 * forgery) check is the Origin alone (O-230), it takes no Idempotency-Key (O-232) and it carries
 * the strict login rate limit (O-236).
 *
 * Mechanism of login: the email is normalized and looked up; the password is verified against the
 * stored argon2id hash, or against DUMMY_PASSWORD_HASH when no account matches, so a missing account
 * costs the same time as a wrong password, and both answer the same 401 problem. On success, in one
 * transaction, the user's expired sessions are deleted and a new one is inserted (sessions.ts); the
 * response sets the session cookie (cookie.ts) and answers SessionInfo, whose csrf_token the browser
 * echoes in x-csrf-token. The lifetime is config.sessionTtlHours, absolute (O-231), which is why
 * app.ts passes the configuration to this plugin. Logout deletes the current row and clears the
 * cookie; GET /me answers SessionInfo for the session the authentication hook found, so a browser
 * refresh recovers the CSRF token without logging in again.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { clearSessionCookie, setSessionCookie } from "../auth/cookie.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../auth/password.js";
import type { SessionContext } from "../auth/session-context.js";
import { createSession, deleteExpiredSessions, deleteSession } from "../auth/sessions.js";
import { findUserCredentials, type UserCredentials } from "../auth/users.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { requireDatabase } from "../http/database.js";
import { csrfOnlyHeadersSchema } from "../http/headers.js";
import { AUTHENTICATED, PUBLIC } from "../http/openapi.js";
import { PROBLEM_SLUGS, ProblemError, problemResponses } from "../http/problem.js";
import { LOGIN_RATE_LIMIT } from "../http/rate-limits.js";
import { requireSession } from "../plugins/authenticate.js";
import { type LoginBody, loginBodySchema, type SessionInfo, sessionInfoSchema } from "../schemas/auth.js";

const TAG = "auth";
const UNAUTHENTICATED_STATUS = 401;
const NO_CONTENT_STATUS = 204;
/** One message for a wrong password and an unknown email, so the answer reveals no account. */
export const INVALID_CREDENTIALS_DETAIL = "Invalid email or password.";

export interface AuthRouteOptions {
  /** Supplies sessionTtlHours, the absolute session lifetime (O-231). */
  config: AppConfig;
}

function sessionInfo(session: Omit<SessionContext, "sessionId">): SessionInfo {
  return {
    user: { id: session.userId, email: session.email, created_at: session.userCreatedAt.toISOString() },
    csrf_token: session.csrfToken,
    expires_at: session.expiresAt.toISOString(),
  };
}

/** The account the credentials prove, or a 401 problem; the timing does not depend on which. */
async function authenticateCredentials(database: Database, body: LoginBody): Promise<UserCredentials> {
  const user = await findUserCredentials(database, body.email);
  const matches = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, body.password);
  if (user === undefined || !matches) {
    throw new ProblemError(UNAUTHENTICATED_STATUS, PROBLEM_SLUGS.unauthenticated, {
      detail: INVALID_CREDENTIALS_DETAIL,
    });
  }
  return user;
}

/** Deletes the user's expired sessions and opens a new one, atomically. */
function openSession(database: Database, user: UserCredentials, ttlHours: number) {
  return database.transaction().execute(async (transaction) => {
    await deleteExpiredSessions(transaction, user.id);
    return createSession(transaction, user.id, ttlHours);
  });
}

export const authRoutes: FastifyPluginCallbackZod<AuthRouteOptions> = (app, options, done) => {
  const { sessionTtlHours } = options.config;

  app.post(
    "/auth/login",
    {
      config: { auth: "none", csrf: "origin-only", idempotent: false, rateLimit: LOGIN_RATE_LIMIT },
      schema: {
        tags: [TAG],
        summary: "Log in with email and password; sets the session cookie",
        security: PUBLIC,
        body: loginBodySchema,
        response: { 200: sessionInfoSchema, ...problemResponses([400, 401, 403, 413, 415, 429, 500]) },
      },
    },
    async (request, reply) => {
      const database = requireDatabase(app);
      const user = await authenticateCredentials(database, request.body);
      const session = await openSession(database, user, sessionTtlHours);
      setSessionCookie(reply, session.token, session.expiresAt);
      return sessionInfo({
        userId: user.id,
        email: user.email,
        userCreatedAt: user.createdAt,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
    },
  );

  app.post(
    "/auth/logout",
    {
      config: { idempotent: false },
      schema: {
        tags: [TAG],
        summary: "End the session and clear the cookie",
        security: AUTHENTICATED,
        headers: csrfOnlyHeadersSchema,
        response: { 204: z.null().describe("Logged out"), ...problemResponses([401, 403, 429, 500]) },
      },
    },
    async (request, reply) => {
      const session = requireSession(request);
      await deleteSession(requireDatabase(app), session.sessionId);
      return clearSessionCookie(reply).code(NO_CONTENT_STATUS).send(null);
    },
  );

  app.get(
    "/me",
    {
      schema: {
        tags: [TAG],
        summary: "The session user and the CSRF token",
        security: AUTHENTICATED,
        response: { 200: sessionInfoSchema, ...problemResponses([401, 429, 500]) },
      },
    },
    (request) => sessionInfo(requireSession(request)),
  );

  done();
};
