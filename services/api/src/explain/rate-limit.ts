/**
 * The Ask rate limit (R3.20, O-307): 5 asks per minute per logged-in session, on top of the
 * global per-address limit, as a module constant so the security plugin keeps one counter store
 * for it (plugins/security.ts picks a route's limiter by its options object).
 *
 * The limiter runs in the security plugin's onRequest hook, before authentication has looked the
 * session up, so the key cannot be the user id. It is the sha256 of the session cookie's value
 * (the raw token never becomes a key), which names one login of one user; a request without the
 * cookie is keyed by its address and is refused by authentication right after.
 */
import { createHash } from "node:crypto";

import type { RateLimitOptions } from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";

import { SESSION_COOKIE_NAME } from "../http/openapi.js";
import { RATE_LIMIT_WINDOW } from "../http/rate-limits.js";

/** Asks per session per window (O-307). */
export const ASK_RATE_LIMIT_MAX = 5;

const COOKIE_SEPARATOR = ";";
const COOKIE_ASSIGNMENT = "=";
const SESSION_KEY_PREFIX = "ask-session:";
const ADDRESS_KEY_PREFIX = "ask-address:";

/** The session cookie's value from a raw Cookie header, or undefined. */
export function sessionCookieValue(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(COOKIE_SEPARATOR)) {
    const [name = "", ...value] = part.trim().split(COOKIE_ASSIGNMENT);
    if (name === SESSION_COOKIE_NAME && value.length > 0) {
      return value.join(COOKIE_ASSIGNMENT);
    }
  }
  return undefined;
}

export function askRateLimitKey(request: FastifyRequest): string {
  const token = sessionCookieValue(request.headers.cookie);
  if (token === undefined || token === "") {
    return `${ADDRESS_KEY_PREFIX}${request.ip}`;
  }
  return `${SESSION_KEY_PREFIX}${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export const ASK_RATE_LIMIT: RateLimitOptions = {
  max: ASK_RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW,
  keyGenerator: askRateLimitKey,
};
