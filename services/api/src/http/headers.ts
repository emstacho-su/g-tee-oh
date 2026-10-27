/**
 * Request header schemas shared by the routes (R3.1, A5 section 3). Header objects are loose:
 * Fastify replaces request.headers with the validated value, so a strict object would strip the
 * cookie and every other header the hooks read.
 *
 * - x-csrf-token: the per-session token from POST /auth/login and GET /me, required on every
 *   mutating route except login (O-230). The CSRF guard runs before validation, so a missing or
 *   wrong token is a 403 csrf problem, not a 400.
 * - Idempotency-Key: optional on every mutating route except login and logout (O-232); 1 to 255
 *   visible ASCII characters, scoped to the session user.
 */
import { z } from "zod";

export const CSRF_HEADER = "x-csrf-token";
export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_REPLAYED_HEADER = "idempotent-replayed";
export const REQUEST_ID_HEADER = "x-request-id";

export const CSRF_TOKEN_MAX_LENGTH = 128;
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export const csrfTokenHeaderSchema = z
  .string()
  .min(1)
  .max(CSRF_TOKEN_MAX_LENGTH)
  .describe("The csrf_token from POST /auth/login or GET /me (O-230)");

export const idempotencyKeyHeaderSchema = z
  .string()
  .regex(IDEMPOTENCY_KEY_PATTERN)
  .describe("Optional; a repeat with the same key and request replays the first response (O-232)");

/** Headers of an authenticated mutating route that accepts an Idempotency-Key. */
export const mutatingHeadersSchema = z.looseObject({
  [CSRF_HEADER]: csrfTokenHeaderSchema,
  [IDEMPOTENCY_HEADER]: idempotencyKeyHeaderSchema.optional(),
});

/** Headers of an authenticated mutating route without idempotency (logout). */
export const csrfOnlyHeadersSchema = z.looseObject({
  [CSRF_HEADER]: csrfTokenHeaderSchema,
});
