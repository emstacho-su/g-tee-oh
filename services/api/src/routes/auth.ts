/**
 * Auth routes (R3.1, A5 section 3, A9 section 3): POST /auth/login, POST /auth/logout, GET /me.
 * Login is the one public mutating route: no session yet, so its CSRF (cross-site request
 * forgery) check is the Origin alone (O-230), it takes no Idempotency-Key (O-232) and it carries
 * the strict login rate limit (O-236).
 */
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { csrfOnlyHeadersSchema } from "../http/headers.js";
import { notImplemented } from "../http/not-implemented.js";
import { AUTHENTICATED, PUBLIC } from "../http/openapi.js";
import { problemResponses } from "../http/problem.js";
import { LOGIN_RATE_LIMIT } from "../http/rate-limits.js";
import { loginBodySchema, sessionInfoSchema } from "../schemas/auth.js";

const TAG = "auth";

export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
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
    (request) => notImplemented(request),
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
    (request) => notImplemented(request),
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
    (request) => notImplemented(request),
  );

  done();
};
