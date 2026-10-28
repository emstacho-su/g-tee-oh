/**
 * The rules a new account's text must meet (R3.1, A9 section 3, O-426), in one place: the
 * create-user command, the join schema and the join route all read them from here (S42 review
 * round 1, J).
 *
 * - Lengths count characters (Unicode code points), the same count Postgres' char_length uses, so
 *   the api and the database check constraint agree on every name.
 * - A new password holds MIN_NEW_PASSWORD_LENGTH to MAX_PASSWORD_LENGTH characters. Login accepts
 *   any stored password; the minimum applies to new accounts only.
 * - A display name is trimmed, then holds 1 to MAX_DISPLAY_NAME_LENGTH characters, at least one
 *   letter or digit, and no control, invisible formatting, default-ignorable, line separator or
 *   paragraph separator character. Text that reorders or hides itself (bidirectional overrides,
 *   zero-width characters, Hangul fillers) or that looks blank (only combining marks, a braille
 *   blank) is refused at the boundary rather than cleaned, because a name is shown to other people.
 */
import { MAX_PASSWORD_LENGTH } from "../schemas/auth.js";

/** The minimum password length for a new account, in characters (A9 section 3). */
export const MIN_NEW_PASSWORD_LENGTH = 12;
export const MAX_DISPLAY_NAME_LENGTH = 60;
/** The raw length a name may have before trimming, so a huge padded value is refused before any work. */
export const MAX_RAW_DISPLAY_NAME_LENGTH = 240;

/**
 * Characters no name may hold: control (Cc), invisible formatting (Cf, bidi overrides included),
 * default-ignorable code points (fillers, variation selectors), line and paragraph separators.
 */
export const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u;
/** A name must show at least one letter or digit, so it can never look blank. */
export const NAME_NEEDS_CHARACTER = /[\p{L}\p{N}]/u;

export type PasswordFailure = "password-too-short" | "password-too-long";
export type NameFailure = "name-empty" | "name-too-long" | "name-forbidden-character" | "name-no-letter";

export function characterCount(text: string): number {
  return Array.from(text).length;
}

/** Why a new password is refused, or null when it is acceptable. */
export function newPasswordFailure(password: string): PasswordFailure | null {
  if (characterCount(password) < MIN_NEW_PASSWORD_LENGTH) return "password-too-short";
  if (password.length > MAX_PASSWORD_LENGTH) return "password-too-long";
  return null;
}

/** Why an already trimmed name is refused, or null when it is acceptable. */
export function displayNameFailure(trimmed: string): NameFailure | null {
  if (trimmed === "") return "name-empty";
  if (characterCount(trimmed) > MAX_DISPLAY_NAME_LENGTH) return "name-too-long";
  if (FORBIDDEN_NAME_CHARACTERS.test(trimmed)) return "name-forbidden-character";
  if (!NAME_NEEDS_CHARACTER.test(trimmed)) return "name-no-letter";
  return null;
}

export const PASSWORD_FAILURE_TEXT: Readonly<Record<PasswordFailure, string>> = {
  "password-too-short": `The password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters long.`,
  "password-too-long": `The password must be at most ${MAX_PASSWORD_LENGTH} characters long.`,
};

export const NAME_FAILURE_TEXT: Readonly<Record<NameFailure, string>> = {
  "name-empty": "Enter a name.",
  "name-too-long": `At most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
  "name-forbidden-character": "Control and invisible characters are not allowed.",
  "name-no-letter": "Use at least one letter or digit.",
};
