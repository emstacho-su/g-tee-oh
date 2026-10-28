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
 * Failed logins per normalized email per window, whatever the client address (O-236 as amended
 * after the PR #20 reviews): caps password guessing even from many addresses. Only failures count
 * and a successful login resets the count, so correct logins never use up the budget; someone
 * sending wrong passwords for the owner's email can make the owner wait until the window that
 * their failures opened ends, at a pace the per-IP limits bound.
 */
export const LOGIN_EMAIL_RATE_LIMIT_MAX = 10;
export const LOGIN_EMAIL_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** The most emails the email limiter tracks at once; expired windows are dropped first. */
export const LOGIN_EMAIL_THROTTLE_MAX_KEYS = 10_000;

/** Invite creates per client IP per minute (S42, O-428): an admin makes a handful at a time. */
export const INVITE_CREATE_RATE_LIMIT_MAX = 10;
export const INVITE_CREATE_RATE_LIMIT = { max: INVITE_CREATE_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } as const;

/** Invite previews per client IP per minute (O-428); the join page asks once per visit. */
export const INVITE_INSPECT_RATE_LIMIT_MAX = 10;
export const INVITE_INSPECT_RATE_LIMIT = { max: INVITE_INSPECT_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } as const;

/** Joins per client IP per minute (O-428), as strict as login. */
export const JOIN_RATE_LIMIT_MAX = 5;
export const JOIN_RATE_LIMIT = { max: JOIN_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } as const;

/**
 * Failed inspect or join attempts per invite id per window, whatever the client address (O-429),
 * the per-invite counterpart of the per-email login limit: one link cannot be tried from many
 * addresses. Unknown ids are counted the same way, so the limit reveals nothing about which exist.
 */
export const INVITE_ATTEMPT_MAX = 10;
export const INVITE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
/** The most invite ids the attempt limiter tracks at once. */
export const INVITE_ATTEMPT_MAX_KEYS = 10_000;

/** Route config value that exempts a probe route from the global limit. */
export const RATE_LIMIT_EXEMPT = false as const;
