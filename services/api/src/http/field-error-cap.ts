/**
 * Bounds on the field errors a problem response carries (R3.1, R3.14, PR #30 review MEDIUM 1,
 * A9 section 3). Shared by every route's validation problem (problem.ts) and the export code's
 * decoder (drills/export-code.ts), so no request can make the api answer an unbounded list.
 *
 * Mechanism:
 * - a problem's errors list keeps at most MAX_PROBLEM_ERRORS entries; the number left out goes in
 *   the problem's errors_omitted member, never as a summary entry inside the list;
 * - an unrecognized-keys issue becomes one entry at the path of the object holding the keys, with
 *   a message that counts them ("3 unknown keys"). The key text is request input, so it never
 *   reaches the response: a client could otherwise make the api echo any text it sent.
 */

/** The most field errors one problem response lists. */
export const MAX_PROBLEM_ERRORS = 20;

/** The issue code Zod gives keys a strict object does not know. */
export const UNRECOGNIZED_KEYS_CODE = "unrecognized_keys";

/** The message of an unrecognized-keys issue: a count, never the keys. */
export function unknownKeysMessage(count: number): string {
  return count === 1 ? "1 unknown key" : `${count} unknown keys`;
}

/** An issue's message, with an unrecognized-keys issue reduced to its count. */
export function safeIssueMessage(code: string, message: string, keys: unknown): string {
  if (code !== UNRECOGNIZED_KEYS_CODE) {
    return message;
  }
  return unknownKeysMessage(Array.isArray(keys) ? keys.length : 1);
}

export interface CappedErrors<Entry> {
  kept: Entry[];
  /** How many entries were left out; 0 when all were kept. */
  omitted: number;
}

/** The first MAX_PROBLEM_ERRORS entries and the count of the rest. */
export function capErrors<Entry>(entries: readonly Entry[]): CappedErrors<Entry> {
  return {
    kept: entries.slice(0, MAX_PROBLEM_ERRORS),
    omitted: Math.max(0, entries.length - MAX_PROBLEM_ERRORS),
  };
}
