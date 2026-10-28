/**
 * Session and CSRF (cross-site request forgery) tokens (R3.1, O-230, O-231). Both are 32 random
 * bytes from the operating system's generator, written as unpadded base64url. The session token
 * lives only in the cookie and the database keeps its sha256 (auth_session.token_hash), so a copy
 * of the table cannot be replayed; the CSRF token is stored as is, since it is useless without
 * the cookie.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_BYTES = 32;
/** 32 bytes as unpadded base64url. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionToken {
  /** What the cookie carries. */
  token: string;
  /** What auth_session.token_hash stores. */
  hash: Buffer;
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function newSessionToken(): SessionToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashSessionToken(token) };
}

export function newCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/**
 * Constant-time equality of two digests (S42, invite secrets): crypto.timingSafeEqual over the
 * bytes; unequal lengths are unequal without comparing, which leaks only the length.
 */
export function digestsEqual(expected: Buffer, given: Buffer): boolean {
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Constant-time string equality for tokens; unequal lengths are unequal without comparing. */
export function tokensEqual(expected: string, given: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(given, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
