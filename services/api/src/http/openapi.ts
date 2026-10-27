/**
 * OpenAPI (Open Application Programming Interface) building blocks shared by the route files
 * (R3.1, O-38): the session cookie security scheme and the problem status sets each kind of route
 * can answer, so every route documents the same failures the hooks actually produce.
 */
export const SESSION_COOKIE_NAME = "__Host-gto_session";
export const SESSION_COOKIE_SCHEME = "sessionCookie";

/** The route-level security requirement for authenticated routes. */
export const AUTHENTICATED = [{ [SESSION_COOKIE_SCHEME]: [] }];
/** The route-level security requirement for public routes. */
export const PUBLIC: Array<Record<string, string[]>> = [];

export const SECURITY_SCHEMES = {
  [SESSION_COOKIE_SCHEME]: {
    type: "apiKey" as const,
    in: "cookie" as const,
    name: SESSION_COOKIE_NAME,
    description: "HTTP-only, Secure, SameSite=Strict session cookie set by POST /auth/login (O-231)",
  },
};

/** An authenticated read. */
export const READ_PROBLEMS = [400, 401, 429, 500] as const;
/** An authenticated read of one resource. */
export const READ_ONE_PROBLEMS = [400, 401, 404, 429, 500] as const;
/** An authenticated mutation with CSRF (cross-site request forgery) and Idempotency-Key handling. */
export const MUTATE_PROBLEMS = [400, 401, 403, 409, 413, 415, 422, 429, 500] as const;
/** An authenticated mutation of one resource. */
export const MUTATE_ONE_PROBLEMS = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500] as const;
/** A route that answers 501 until its owner builds it; the status set it will answer then. */
export const PLANNED_READ_PROBLEMS = [400, 401, 404, 429, 500, 501] as const;
export const PLANNED_MUTATE_PROBLEMS = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 501] as const;
