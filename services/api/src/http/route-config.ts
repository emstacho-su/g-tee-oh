/**
 * Per-route policy flags (R3.1). Every route states its policy in its Fastify config, and the
 * cross-cutting hooks (authentication, the CSRF (cross-site request forgery) guard, the
 * Idempotency-Key handler) read it from request.routeOptions.config, so a route file never wires
 * a hook by hand and a new route cannot forget one: the defaults are the strict choices.
 *
 * - auth: "required" (default) needs a live session; "none" is for login and the probes.
 * - csrf: applies to mutating methods only. "token" (default) checks the Origin and the
 *   per-session x-csrf-token header (O-230); "origin-only" checks the Origin alone, for login,
 *   which has no session yet; "none" is never used by a mutating route.
 * - idempotent: mutating routes accept an Idempotency-Key unless this is false (O-232; login and
 *   logout opt out).
 */
import "fastify";

export type AuthPolicy = "required" | "none";
export type CsrfPolicy = "token" | "origin-only" | "none";

export interface RoutePolicy {
  auth?: AuthPolicy;
  csrf?: CsrfPolicy;
  idempotent?: boolean;
  /** The session that builds a 501 route, shown in its problem detail and its description. */
  owner?: string;
}

declare module "fastify" {
  // Declaration merging needs an interface; it adds RoutePolicy's members to Fastify's route config.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FastifyContextConfig extends RoutePolicy {}
}

export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = "required";
export const DEFAULT_CSRF_POLICY: CsrfPolicy = "token";
