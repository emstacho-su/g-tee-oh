/**
 * The session cookie's attributes (R3.1, A9 section 3, O-231). Login sets the cookie and logout
 * clears it with the same attributes, so the browser treats the clearing Set-Cookie as the same
 * cookie and drops it.
 *
 * Mechanism: the name carries the __Host- prefix (SESSION_COOKIE_NAME), which browsers accept only
 * when the cookie is Secure, has Path=/ and has no Domain attribute; that pins it to the exact
 * host that set it, so a sibling subdomain can neither read nor overwrite it. HttpOnly keeps it out
 * of page scripts, and SameSite=Strict keeps it off every cross-site request, which is the first
 * layer of the CSRF (cross-site request forgery) defence (O-230). Expires equals the session's
 * absolute expiry; the database row's expires_at is the authority, the cookie date only spares the
 * browser a request it would lose. Secure works on the dev profile too, because Caddy serves the
 * app at https://localhost with its internal certificate authority (infra/compose/Caddyfile).
 *
 * @fastify/cookie (registered by plugins/authenticate.ts) adds reply.setCookie and
 * reply.clearCookie; clearCookie writes an empty value with Expires in 1970 and Max-Age=0.
 */
import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyReply } from "fastify";

import { SESSION_COOKIE_NAME } from "../http/openapi.js";

const SESSION_COOKIE_PATH = "/";

/** The attributes shared by setting and clearing the cookie; no domain, as __Host- requires. */
function baseCookieOptions(): CookieSerializeOptions {
  return { httpOnly: true, secure: true, sameSite: "strict", path: SESSION_COOKIE_PATH };
}

/** The options for the cookie a login sets; it expires with the session row. */
export function sessionCookieOptions(expiresAt: Date): CookieSerializeOptions {
  return { ...baseCookieOptions(), expires: expiresAt };
}

/** The options for clearing the cookie: the same attributes, the expiry is set by clearCookie. */
export function clearedSessionCookieOptions(): CookieSerializeOptions {
  return baseCookieOptions();
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): FastifyReply {
  return reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}

export function clearSessionCookie(reply: FastifyReply): FastifyReply {
  return reply.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions());
}
