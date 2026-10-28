/**
 * The Ask rate limit (R3.20, O-307, PR #29 review M3): 5 asks per minute per user, on top of the
 * global per-address limit, which applies to Ask as to every route (the route sets no rateLimit
 * of its own, so plugins/security.ts runs the global limiter for it).
 *
 * The limit runs in the route's own onRequest hook. Fastify runs route hooks after the root ones,
 * so authentication has already found the session (an unauthenticated ask was refused with a 401
 * before this point) and the key is the user id: every session of the user, every spelling of its
 * cookie (percent-encoded, reordered, with other cookies) and a fresh login all share one bucket.
 * It runs before the Idempotency-Key claim (a preHandler), so a refused ask claims no key and a
 * retry under the same key is counted again rather than replaying the 429.
 *
 * The counter is a fixed window per user (auth/login-throttle.ts, the same bounded in-memory store
 * the login email limit uses; the api is one process per host): check, then count the ask.
 */
import type { FastifyRequest } from "fastify";

import { LoginThrottle } from "../auth/login-throttle.js";
import { RETRY_AFTER_HEADER } from "../http/headers.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { requireSession } from "../plugins/authenticate.js";

/** Asks per user per window (O-307). */
export const ASK_RATE_LIMIT_MAX = 5;
/** The window, in milliseconds: one minute, as RATE_LIMIT_WINDOW. */
export const ASK_RATE_LIMIT_WINDOW_MS = 60_000;
/** The most users tracked at once; a personal deployment has a handful. */
export const ASK_RATE_LIMIT_MAX_KEYS = 10_000;

export interface AskLimiter {
  /** Counts one ask for the request's user, or throws the 429 problem. */
  take(request: FastifyRequest): void;
}

export function createAskLimiter(now?: () => number): AskLimiter {
  const throttle = new LoginThrottle({
    max: ASK_RATE_LIMIT_MAX,
    windowMs: ASK_RATE_LIMIT_WINDOW_MS,
    maxKeys: ASK_RATE_LIMIT_MAX_KEYS,
    ...(now === undefined ? {} : { now }),
  });
  return {
    take: (request) => {
      const { userId } = requireSession(request);
      const verdict = throttle.check(userId);
      if (!verdict.allowed) {
        throw new ProblemError(HTTP_STATUS.tooManyRequests, PROBLEM_SLUGS.rateLimited, {
          detail: "Too many questions in a minute; retry shortly.",
          headers: { [RETRY_AFTER_HEADER]: String(verdict.retryAfterSeconds) },
        });
      }
      // LoginThrottle counts "failures"; here every ask counts toward the window.
      throttle.recordFailure(userId);
    },
  };
}
