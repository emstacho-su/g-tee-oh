/**
 * Auth routes (R3.1, A5 section 3, A9 section 3): POST /auth/login, POST /auth/logout, GET /me.
 * Login is the one public mutating route: no session yet, so its CSRF (cross-site request
 * forgery) check is the Origin alone (O-230), it takes no Idempotency-Key (O-232), and it carries
 * two limits (O-236): the strict per-client-IP limit in its route config and a per-email limit
 * (LoginThrottle) that counts the failed attempts for an account whatever address sends them and
 * is reset by a successful login.
 *
 * Mechanism of login: the schema trims and lowercases the email; the per-email limit is checked
 * without counting; the password is verified against the stored argon2id hash, or against
 * DUMMY_PASSWORD_HASH when no account matches, so a missing account costs the same time as a
 * wrong password, and both answer the same 401 problem and count one failure for the email. On success, in one transaction, the session whose cookie came with
 * the request (if any) and the user's expired sessions are deleted and a new one is inserted
 * (sessions.ts); the response sets the session cookie (cookie.ts) and answers SessionInfo, whose
 * csrf_token the browser echoes in x-csrf-token. The lifetime is config.sessionTtlHours, absolute
 * (O-231). Login's auth policy is "none", so the authentication hook never reads its cookie; the
 * handler reads it itself only to delete that older session.
 *
 * Logout's auth policy is "optional": it always answers 204 and clears the cookie, also when the
 * session has expired or none was sent, and a live session is deleted (its CSRF token is still
 * required then) and its open event streams are ended (O-243). GET /me answers SessionInfo for the session the authentication hook found, so a
 * browser refresh recovers the CSRF token without logging in again.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { clearSessionCookie, setSessionCookie } from "../auth/cookie.js";
import { LoginThrottle } from "../auth/login-throttle.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../auth/password.js";
import type { SessionContext } from "../auth/session-context.js";
import { createSession, deleteExpiredSessions, deleteSession, deleteSessionByToken } from "../auth/sessions.js";
import { findUserCredentials, type UserCredentials } from "../auth/users.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { eventHub } from "../events/registry.js";
import { requireDatabase } from "../http/database.js";
import { optionalCsrfHeadersSchema } from "../http/headers.js";
import { AUTHENTICATED, OPTIONAL_SESSION, PUBLIC, SESSION_COOKIE_NAME } from "../http/openapi.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError, problemResponses } from "../http/problem.js";
import {
  LOGIN_EMAIL_RATE_LIMIT_MAX,
  LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS,
  LOGIN_EMAIL_THROTTLE_MAX_KEYS,
  LOGIN_RATE_LIMIT,
} from "../http/rate-limits.js";
import { requireSession } from "../plugins/authenticate.js";
import { type LoginBody, loginBodySchema, type SessionInfo, sessionInfoSchema } from "../schemas/auth.js";

const TAG = "auth";
const RETRY_AFTER_HEADER = "retry-after";
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
    throw new ProblemError(HTTP_STATUS.unauthorized, PROBLEM_SLUGS.unauthenticated, {
      detail: INVALID_CREDENTIALS_DETAIL,
    });
  }
  return user;
}

/** Replaces the presented session (if any) and the user's expired ones with a new session, atomically. */
function openSession(database: Database, user: UserCredentials, ttlHours: number, previousToken: string | undefined) {
  return database.transaction().execute(async (transaction) => {
    if (previousToken !== undefined) {
      await deleteSessionByToken(transaction, previousToken);
    }
    await deleteExpiredSessions(transaction, user.id);
    return createSession(transaction, user.id, ttlHours);
  });
}

function checkEmailLimit(throttle: LoginThrottle, email: string): void {
  const verdict = throttle.check(email);
  if (!verdict.allowed) {
    throw new ProblemError(HTTP_STATUS.tooManyRequests, PROBLEM_SLUGS.rateLimited, {
      detail: "Too many login attempts for this account; retry later.",
      headers: { [RETRY_AFTER_HEADER]: String(verdict.retryAfterSeconds) },
    });
  }
}

export const authRoutes: FastifyPluginCallbackZod<AuthRouteOptions> = (app, options, done) => {
  const { sessionTtlHours } = options.config;
  const emailThrottle = new LoginThrottle({
    max: LOGIN_EMAIL_RATE_LIMIT_MAX,
    windowMs: LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS,
    maxKeys: LOGIN_EMAIL_THROTTLE_MAX_KEYS,
  });

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
      const { email } = request.body;
      checkEmailLimit(emailThrottle, email);
      const database = requireDatabase(app);
      let user: UserCredentials;
      try {
        user = await authenticateCredentials(database, request.body);
      } catch (error: unknown) {
        // Only a rejected password counts toward the per-email limit (O-236); a database error does not.
        if (error instanceof ProblemError && error.status === HTTP_STATUS.unauthorized) {
          emailThrottle.recordFailure(email);
        }
        throw error;
      }
      emailThrottle.reset(email);
      const previousToken = request.cookies[SESSION_COOKIE_NAME];
      const session = await openSession(database, user, sessionTtlHours, previousToken);
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
      config: { auth: "optional", idempotent: false },
      schema: {
        tags: [TAG],
        summary: "End the session, if any, and clear the cookie",
        security: OPTIONAL_SESSION,
        headers: optionalCsrfHeadersSchema,
        response: { 204: z.null().describe("Logged out"), ...problemResponses([403, 429, 500]) },
      },
    },
    async (request, reply) => {
      if (request.session !== null) {
        const { sessionId } = request.session;
        await deleteSession(requireDatabase(app), sessionId);
        // The session's open event streams end now rather than at their next heartbeat recheck
        // (O-243, PR #25 review L2).
        eventHub(app).closeSession(sessionId);
      }
      return clearSessionCookie(reply).code(HTTP_STATUS.noContent).send(null);
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
