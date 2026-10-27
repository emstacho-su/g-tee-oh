/**
 * Rate limits (R3.1, A9 section 3, O-236). Every route has a generous per-client-IP limit, and
 * login has a strict one on top, so password guessing trips quickly while normal use never sees a
 * 429. The probes (health, the OpenAPI document) are exempt so a container health check or a
 * client generator never counts. Limits are in memory: the api runs as one process per host.
 */
// Brings the plugin's route-config typing (config.rateLimit) into every route file.
import type {} from "@fastify/rate-limit";

export const RATE_LIMIT_WINDOW = "1 minute";

/** Requests per client IP per minute on every route. */
export const GLOBAL_RATE_LIMIT_MAX = 300;

/** Login attempts per client IP per minute. */
export const LOGIN_RATE_LIMIT_MAX = 5;

export const LOGIN_RATE_LIMIT = { max: LOGIN_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } as const;

/**
 * Login attempts per normalized email per window, whatever the client address (O-236 as amended
 * after the PR #20 security review): caps password guessing even from many addresses. The cost is
 * that someone hammering the owner's email can hold the owner off for one window.
 */
export const LOGIN_EMAIL_RATE_LIMIT_MAX = 10;
export const LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** The most emails the email limiter tracks at once; expired windows are dropped first. */
export const LOGIN_EMAIL_THROTTLE_MAX_KEYS = 10_000;

/** Route config value that exempts a probe route from the global limit. */
export const RATE_LIMIT_EXEMPT = false as const;
