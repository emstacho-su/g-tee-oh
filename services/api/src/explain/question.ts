/**
 * The Ask question at the boundary (R3.20, O-307, PM3): after the body schema has trimmed it and
 * capped it at 500 characters, every control character becomes a space and every invisible format
 * character (zero-width and bidirectional marks) is removed, then runs of whitespace collapse to
 * one space. The cleaned text is what the model's user turn carries; the cache key hashes its
 * lowercase form (PM1), so a question differing only in case or spacing hits the same entry.
 */

const CONTROL_CHARACTERS = /\p{Cc}/gu;
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const WHITESPACE_RUN = /\s+/g;
const SPACE = " ";
const NOTHING = "";

/** The question with control and format characters gone and whitespace collapsed; "" when nothing is left. */
export function cleanQuestion(question: string): string {
  return question.replace(CONTROL_CHARACTERS, SPACE).replace(FORMAT_CHARACTERS, NOTHING).replace(WHITESPACE_RUN, SPACE).trim();
}

/** The form the cache key hashes: the cleaned question in lowercase (PM1). */
export function normalizeQuestion(question: string): string {
  return cleanQuestion(question).toLowerCase();
}
