/**
 * The Ask question's cleaning rule (R3.20, O-307), used by explain/question.ts. After the body
 * schema has trimmed and capped the text, every control character becomes a space, every invisible
 * format character (zero-width and bidirectional marks) is removed, and runs of whitespace collapse
 * to one space; the result is trimmed again. The quiz answer's reason does not use it: it follows
 * the stricter shared rule in @g-tee-oh/contracts (rationale.ts: NFC, default-ignorable code points,
 * visible characters, the code-point bound), which the web applies too (PR #39 review finding 3).
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
