/**
 * Joining by invite (S42, R3.1, O-349, O-421, O-422, O-426, O-428, O-429): POST
 * /auth/invites/inspect and POST /auth/join. Both are public, like login: no session yet, so the
 * CSRF (cross-site request forgery) check is the Origin alone, no Idempotency-Key (single use makes
 * a retry safe: it gets 410), a strict per-IP limit each (O-428), and a shared per-invite cap on
 * failed attempts (O-429) that counts by the token's selector whatever address sends it.
 *
 * Mechanism: the token's shape is checked here, not by the schema, so a malformed token answers
 * the same 410 invite-invalid problem as an unknown, wrong, expired, used or revoked one (O-422).
 * Exactly one constant-time digest comparison runs per request (auth/invites.ts usableInvite).
 * Join does all of its work in one transaction: lock the invite row (select ... for update), check
 * it, create the user with the invite's email, the given name and the existing password rules,
 * mark the invite used by that user, delete the session whose cookie came with the request (no
 * session fixation) and open a new one. Any failure rolls all of it back, so the invite stays
 * unused. Only after the commit does the response set the cookie. The token, the secret and the
 * password are never logged and never echoed: problems carry fixed texts, and Fastify logs neither
 * request nor response bodies.
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { findInvite, inviteInvalid, markInviteUsed, usableInvite } from "../auth/invites.js";
import { parseInviteToken, type ParsedInviteToken } from "../auth/invite-token.js";
import { LoginThrottle } from "../auth/login-throttle.js";
import { replaceSession, sessionInfo } from "../auth/open-session.js";
import { createUser, CreateUserError } from "../auth/users.js";
import { requireDatabase } from "../http/database.js";
import { PUBLIC, SESSION_COOKIE_NAME } from "../http/openapi.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError, problemResponses } from "../http/problem.js";
import {
  INVITE_ATTEMPT_MAX,
  INVITE_ATTEMPT_MAX_KEYS,
  INVITE_ATTEMPT_WINDOW_MS,
  INVITE_INSPECT_RATE_LIMIT,
  JOIN_RATE_LIMIT,
} from "../http/rate-limits.js";
import { setSessionCookie } from "../auth/cookie.js";
import { sessionInfoSchema } from "../schemas/auth.js";
import { inspectInviteBodySchema, invitePreviewSchema, joinBodySchema } from "../schemas/invites.js";
import type { ConfiguredRouteOptions } from "./route-options.js";

const TAG = "auth";
const RETRY_AFTER_HEADER = "retry-after";
const PUBLIC_POLICY = { auth: "none", csrf: "origin-only", idempotent: false } as const;

function checkAttempts(throttle: LoginThrottle, token: ParsedInviteToken | null): void {
  if (token === null) return;
  const verdict = throttle.check(token.selector);
  if (!verdict.allowed) {
    throw new ProblemError(HTTP_STATUS.tooManyRequests, PROBLEM_SLUGS.rateLimited, {
      detail: "Too many attempts with this invite link; retry later.",
      headers: { [RETRY_AFTER_HEADER]: String(verdict.retryAfterSeconds) },
    });
  }
}

/** Counts a failed attempt against the token's selector when the answer is invite-invalid. */
function recordIfInvalid(throttle: LoginThrottle, token: ParsedInviteToken | null, error: unknown): void {
  if (token !== null && error instanceof ProblemError && error.slug === PROBLEM_SLUGS.inviteInvalid) {
    throttle.recordFailure(token.selector);
  }
}

function accountExists(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.conflict, {
    detail: "An account already exists for this invite's email; sign in instead.",
  });
}

export const joinRoutes: FastifyPluginCallbackZod<ConfiguredRouteOptions> = (app, options, done) => {
  const { sessionTtlHours } = options.config;
  const attempts = new LoginThrottle({
    max: INVITE_ATTEMPT_MAX,
    windowMs: INVITE_ATTEMPT_WINDOW_MS,
    maxKeys: INVITE_ATTEMPT_MAX_KEYS,
  });

  app.post(
    "/auth/invites/inspect",
    {
      config: { ...PUBLIC_POLICY, rateLimit: INVITE_INSPECT_RATE_LIMIT },
      schema: {
        tags: [TAG],
        summary: "The email and expiry of a usable invite; 410 for any bad token (O-422)",
        security: PUBLIC,
        body: inspectInviteBodySchema,
        response: { 200: invitePreviewSchema, ...problemResponses([400, 403, 410, 413, 415, 429, 500]) },
      },
    },
    async (request) => {
      const token = parseInviteToken(request.body.token);
      checkAttempts(attempts, token);
      try {
        const row = token === null ? undefined : await findInvite(requireDatabase(app), token.selector);
        const invite = usableInvite(row, token, new Date());
        if (invite === undefined) throw inviteInvalid();
        return { email: invite.email, expires_at: invite.expiresAt.toISOString() };
      } catch (error: unknown) {
        recordIfInvalid(attempts, token, error);
        throw error;
      }
    },
  );

  app.post(
    "/auth/join",
    {
      config: { ...PUBLIC_POLICY, rateLimit: JOIN_RATE_LIMIT },
      schema: {
        tags: [TAG],
        summary: "Create an account from an invite and sign in; sets the session cookie (O-349)",
        security: PUBLIC,
        body: joinBodySchema,
        response: { 200: sessionInfoSchema, ...problemResponses([400, 403, 409, 410, 413, 415, 429, 500]) },
      },
    },
    async (request, reply) => {
      const token = parseInviteToken(request.body.token);
      checkAttempts(attempts, token);
      const previousToken = request.cookies[SESSION_COOKIE_NAME];
      const now = new Date();
      try {
        const joined = await requireDatabase(app)
          .transaction()
          .execute(async (transaction) => {
            const row = token === null ? undefined : await findInvite(transaction, token.selector, true);
            const invite = usableInvite(row, token, now);
            if (invite === undefined) throw inviteInvalid();
            const user = await createUser(transaction, {
              email: invite.email,
              password: request.body.password,
              displayName: request.body.display_name,
            });
            await markInviteUsed(transaction, invite.id, user.id, now);
            const session = await replaceSession(transaction, user.id, sessionTtlHours, previousToken);
            return { user, session };
          });
        setSessionCookie(reply, joined.session.token, joined.session.expiresAt);
        return sessionInfo({
          userId: joined.user.id,
          email: joined.user.email,
          displayName: joined.user.displayName,
          userCreatedAt: joined.user.createdAt,
          isAdmin: joined.user.isAdmin,
          csrfToken: joined.session.csrfToken,
          expiresAt: joined.session.expiresAt,
        });
      } catch (error: unknown) {
        recordIfInvalid(attempts, token, error);
        if (error instanceof CreateUserError && error.reason === "duplicate-email") throw accountExists();
        throw error;
      }
    },
  );

  done();
};
