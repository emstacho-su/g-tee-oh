/**
 * The quiz answer's typed reason (R3.16, S41, O-412, PR #39 review finding 3 and security LOW 1): the
 * one cleaning and counting rule the api applies at its boundary and the web applies before it
 * enables Submit, so the two can never disagree.
 *
 * Cleaning, in order: NFC normalisation; every default-ignorable code point removed (zero-width and
 * bidirectional marks, the Hangul fillers U+3164 and U+FFA0, the combining grapheme joiner U+034F,
 * variation selectors); every remaining control or format character becomes a space; runs of
 * whitespace collapse to one space; the ends are trimmed.
 *
 * Counting: a reason is ready when its cleaned form holds at least RATIONALE_MIN_CHARS visible
 * characters, a letter, a number or a punctuation mark (\p{L}, \p{N}, \p{P}) counted by code point.
 * Spaces, symbols such as the blank braille pattern U+2800, and bare combining marks never count, so
 * a reason that only looks typed is refused. RATIONALE_MAX_CHARS bounds the raw text in UTF-16 units,
 * as the body schema and a textarea's maxLength both count, and the cleaned text in code points, as
 * the database check counts.
 */

export const RATIONALE_MIN_CHARS = 3;
export const RATIONALE_MAX_CHARS = 1000;

const NORMAL_FORM = "NFC";
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/gu;
const VISIBLE = /[\p{L}\p{N}\p{P}]/u;
const SPACE = " ";
const NOTHING = "";

/** The reason as the api stores it. */
export function cleanRationale(text: string): string {
  return text
    .normalize(NORMAL_FORM)
    .replace(DEFAULT_IGNORABLE, NOTHING)
    .replace(CONTROL_OR_FORMAT, SPACE)
    .replace(WHITESPACE_RUN, SPACE)
    .trim();
}

/** The visible characters (letters, numbers, punctuation) in the cleaned reason, by code point. */
export function visibleRationaleChars(text: string): number {
  return [...cleanRationale(text)].filter((character) => VISIBLE.test(character)).length;
}

/**
 * True when the api will accept the reason: the raw text within RATIONALE_MAX_CHARS UTF-16 units,
 * the cleaned text within RATIONALE_MAX_CHARS code points (what the database's char_length check
 * counts; NFC can lengthen a text, so U+FB2C, one unit, becomes three code points, PR #39 re-review
 * MEDIUM), and at least RATIONALE_MIN_CHARS visible characters.
 */
export function rationaleReady(text: string): boolean {
  const cleaned = [...cleanRationale(text)];
  const visible = cleaned.filter((character) => VISIBLE.test(character)).length;
  return text.length <= RATIONALE_MAX_CHARS && cleaned.length <= RATIONALE_MAX_CHARS && visible >= RATIONALE_MIN_CHARS;
}
