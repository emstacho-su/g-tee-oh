/**
 * Free text at the api boundary (R3.20, R3.16, O-307, O-412): the one cleaning rule the Ask question
 * (explain/question.ts) and the quiz answer's reason (prediction/rationale.ts) share. After the body
 * schema has trimmed and capped the text, every control character becomes a space, every invisible
 * format character (zero-width and bidirectional marks) is removed, and runs of whitespace collapse
 * to one space; the result is trimmed again.
 */

const CONTROL_CHARACTERS = /\p{Cc}/gu;
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const WHITESPACE_RUN = /\s+/g;
const SPACE = " ";
const NOTHING = "";

/** The text with control and format characters gone and whitespace collapsed; "" when nothing is left. */
export function cleanFreeText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, SPACE).replace(FORMAT_CHARACTERS, NOTHING).replace(WHITESPACE_RUN, SPACE).trim();
}
