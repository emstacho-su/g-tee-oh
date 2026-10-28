/**
 * The account and invite rules the web checks before it sends anything (S42, R3.13, R3.5, O-420,
 * O-424, O-426), in one module that mirrors the api's services/api/src/auth/account-rules.ts and
 * auth/invites.ts (review round 1, I and J). The api stays the authority: these checks only spare
 * a request that would be refused. A test holds MAX_RAW_NAME_LENGTH to the committed contract.
 *
 * Lengths count characters (Unicode code points), as the api and Postgres do.
 */

/** The new-account password minimum, in characters (A9 section 3). */
export const MIN_PASSWORD_LENGTH = 12;
/** A name holds at most this many characters after trimming (O-426). */
export const MAX_NAME_LENGTH = 60;
/** The raw length a name may have before trimming; the contract's maxLength for display_name. */
export const MAX_RAW_NAME_LENGTH = 240;
/** How long an invite link works, from creation (O-420). */
export const INVITE_TTL_DAYS = 7;

/** Control, invisible formatting, default-ignorable, line and paragraph separator characters. */
export const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u;
/** A name must show at least one letter or digit. */
export const NAME_NEEDS_CHARACTER = /[\p{L}\p{N}]/u;
/** A loose email shape: something, an @, something, a dot, something; the api checks the rest. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NameProblem = "empty" | "too-long" | "forbidden-character" | "no-letter";

export function characterCount(text: string): number {
  return Array.from(text).length;
}

export function meetsPasswordMinimum(password: string): boolean {
  return characterCount(password) >= MIN_PASSWORD_LENGTH;
}

/** Why a name is refused once trimmed, or null when the api would accept it. */
export function nameProblem(rawName: string): NameProblem | null {
  const name = rawName.trim();
  if (name === "") return "empty";
  if (characterCount(name) > MAX_NAME_LENGTH) return "too-long";
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) return "forbidden-character";
  if (!NAME_NEEDS_CHARACTER.test(name)) return "no-letter";
  return null;
}
