/**
 * Invite link tokens (S42, R3.1, O-349, O-422). A token is "<invite id>.<secret>": the invite's
 * uuid as a selector, a dot, then 32 random bytes from the operating system's generator as
 * unpadded base64url (43 characters). The database keeps only sha256(secret), so the raw token
 * exists once, in the create response.
 *
 * Mechanism: parseInviteToken splits and checks the shape without touching the database; the
 * caller looks the row up by the selector and calls secretMatches, which hashes the given secret
 * and compares the two 32-byte digests with crypto.timingSafeEqual (digestsEqual). When no row
 * matches the selector, the caller compares against UNKNOWN_INVITE_DIGEST instead, so an unknown
 * id and a wrong secret do the same work. The secret is never logged or echoed; the selector is
 * not secret.
 */
import { createHash, randomBytes } from "node:crypto";

import { digestsEqual, isWellFormedToken, TOKEN_BYTES } from "./tokens.js";

export const INVITE_TOKEN_SEPARATOR = ".";
/** A uuid in its canonical lowercase or uppercase hex form. */
const SELECTOR_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** The longest text accepted as a token before parsing: a uuid, the dot and the secret, with room. */
export const MAX_INVITE_TOKEN_LENGTH = 128;

export interface InviteSecret {
  /** What the link carries after the selector; never stored. */
  secret: string;
  /** What invite.secret_hash stores. */
  hash: Buffer;
}

export interface ParsedInviteToken {
  selector: string;
  secret: string;
}

/** The sha256 the database stores for a secret. */
export function hashInviteSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** A fixed digest that matches no secret, compared against when the selector names no invite. */
export const UNKNOWN_INVITE_DIGEST: Buffer = hashInviteSecret("g-tee-oh unknown invite: no secret hashes to this");

export function newInviteSecret(): InviteSecret {
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  return { secret, hash: hashInviteSecret(secret) };
}

export function formatInviteToken(inviteId: string, secret: string): string {
  return `${inviteId}${INVITE_TOKEN_SEPARATOR}${secret}`;
}

/** The selector (lowercased) and secret of a well-formed token, or null for anything else. */
export function parseInviteToken(token: string): ParsedInviteToken | null {
  if (token.length > MAX_INVITE_TOKEN_LENGTH) return null;
  const separator = token.indexOf(INVITE_TOKEN_SEPARATOR);
  if (separator < 0) return null;
  const selector = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!SELECTOR_PATTERN.test(selector) || !isWellFormedToken(secret)) return null;
  return { selector: selector.toLowerCase(), secret };
}

/** True when the secret hashes to the stored digest; constant time over the two digests. */
export function secretMatches(storedHash: Buffer, secret: string): boolean {
  return digestsEqual(storedHash, hashInviteSecret(secret));
}
