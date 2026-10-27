/**
 * Request-level security controls (R3.1, A9 section 3, O-236, O-158): the request id on every
 * response, helmet headers, CORS (cross-origin resource sharing) locked to the app origin, and the
 * global and login rate limits.
 *
 * Mechanism, in hook order (this plugin is registered first, so all of it runs before
 * authentication):
 * - The text/plain body parser Fastify installs by default is removed, so a JSON route answers 415
 *   to it: text/plain is one of the content types a cross-site form can POST without a preflight.
 * - An onSend hook writes x-request-id and cache-control: no-store on every response, errors and
 *   preflights included (login and /me carry the CSRF token and the email).
 * - helmet adds its headers in onRequest. The Content-Security-Policy allows nothing (default-src
 *   and frame-ancestors 'none'): the api serves JSON only, never a page or a script.
 * - CORS reflects the request Origin only when it equals config.appOrigin (an array origin, so a
 *   foreign Origin gets no Access-Control-Allow-Origin at all), with credentials, and answers
 *   preflights inside its onRequest hook, before authentication can ask for a cookie the browser
 *   does not send on a preflight. It runs before the limiter so a 429 is readable by the app.
 * - Rate limits: @fastify/rate-limit attaches its limiter as a route-level onRequest hook, and
 *   Fastify runs route-level hooks after root hooks, so on its own it would count a request only
 *   after authentication had already refused or looked it up. Here the plugin is registered with
 *   global false and one root onRequest hook picks the limiter per route instead: none for
 *   rateLimit false (the probes), the route's own for an object (login, LOGIN_RATE_LIMIT), the
 *   global one (GLOBAL_RATE_LIMIT_MAX per RATE_LIMIT_WINDOW) otherwise, unknown paths included.
 *   Running a limiter marks the request, so the plugin's own route hook for login skips it and a
 *   login is counted once. The key is the client IP (request.ip; X-Forwarded-For counts only from a
 *   trusted proxy address, config.trustedProxies). An
 *   exceeded limit throws a ProblemError, so the error handler answers an RFC 9457 problem with
 *   Retry-After.
 */
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";

import type { AppConfig } from "../config.js";
import { CSRF_HEADER, IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER, REQUEST_ID_HEADER } from "../http/headers.js";
import { PROBLEM_SLUGS, ProblemError, HTTP_STATUS } from "../http/problem.js";
import { GLOBAL_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW } from "../http/rate-limits.js";

export interface SecurityOptions {
  config: AppConfig;
}

const MS_PER_SECOND = 1000;
const RETRY_AFTER_HEADER = "retry-after";
const TEXT_PLAIN = "text/plain";
const CACHE_CONTROL_HEADER = "cache-control";
const NO_STORE = "no-store";

export const CORS_METHODS: readonly string[] = ["GET", "POST", "PATCH", "DELETE"];
export const CORS_ALLOWED_HEADERS: readonly string[] = [
  "content-type",
  CSRF_HEADER,
  IDEMPOTENCY_HEADER,
  REQUEST_ID_HEADER,
];
export const CORS_EXPOSED_HEADERS: readonly string[] = [
  REQUEST_ID_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  RETRY_AFTER_HEADER,
];

/** The 429 problem; the limiter already set Retry-After on the reply, this repeats it. */
function rateLimitedProblem(_request: FastifyRequest, context: { ttl: number; after: string }): ProblemError {
  const retryAfterSeconds = Math.max(1, Math.ceil(context.ttl / MS_PER_SECOND));
  return new ProblemError(HTTP_STATUS.tooManyRequests, PROBLEM_SLUGS.rateLimited, {
    detail: `Too many requests from this client; retry in ${context.after}.`,
    headers: { [RETRY_AFTER_HEADER]: String(retryAfterSeconds) },
  });
}

type Limiter = ReturnType<FastifyInstance["rateLimit"]>;

async function registerRateLimits(app: FastifyInstance): Promise<void> {
  await app.register(fastifyRateLimit, {
    global: false,
    max: GLOBAL_RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    errorResponseBuilder: rateLimitedProblem,
  });

  const globalLimiter: Limiter = app.rateLimit();
  // One limiter (and so one counter store) per distinct route limit, created on first use.
  const routeLimiters = new WeakMap<RateLimitOptions, Limiter>();
  const limiterFor = (routeLimit: RateLimitOptions): Limiter => {
    const existing = routeLimiters.get(routeLimit);
    if (existing !== undefined) {
      return existing;
    }
    const created: Limiter = app.rateLimit(routeLimit);
    routeLimiters.set(routeLimit, created);
    return created;
  };

  app.addHook("onRequest", async (request, reply) => {
    const routeLimit = request.routeOptions.config.rateLimit;
    if (routeLimit === false) {
      return;
    }
    const limiter = routeLimit === undefined ? globalLimiter : limiterFor(routeLimit);
    await limiter.call(app, request, reply);
  });
}

async function securityPlugin(app: FastifyInstance, options: SecurityOptions): Promise<void> {
  // JSON only: text/plain is a content type a cross-site form may send without a CORS preflight.
  app.removeContentTypeParser(TEXT_PLAIN);

  app.addHook("onSend", (request, reply, payload, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    // Login and /me carry the CSRF token and the email: no response of this api may be cached.
    reply.header(CACHE_CONTROL_HEADER, NO_STORE);
    done(null, payload);
  });

  await app.register(fastifyHelmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });

  await app.register(fastifyCors, {
    origin: [options.config.appOrigin],
    credentials: true,
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  });

  await registerRateLimits(app);
}

/** Not encapsulated (fastify-plugin), so every hook applies to every route registered after it. */
export const security = fastifyPlugin(securityPlugin, { name: "g-tee-oh-security" });
