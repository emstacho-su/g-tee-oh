/**
 * The quiz answer's typed reason at the boundary (R3.16, S41, O-350, O-412). The body schema has
 * trimmed it and capped it at RATIONALE_MAX_CHARS UTF-16 units; here the one rule the web applies
 * before it enables Submit (@g-tee-oh/contracts rationale.ts, PR #39 review finding 3) decides:
 * checkRationale, which cleans the reason once and returns the cleaned text with its verdict (PR #41
 * review round 1, finding 7). It cleans the reason (NFC, default-ignorable code points removed, control and
 * format characters as spaces, whitespace collapsed) and requires the cleaned text to hold at most
 * RATIONALE_MAX_CHARS code points (the database check's count, which NFC can grow past the raw
 * bound, PR #39 re-review MEDIUM) and at least RATIONALE_MIN_CHARS visible characters (letters,
 * numbers, punctuation; security review LOW 1). Anything else is a 400 validation problem naming
 * body.rationale, before anything is judged or written. The cleaned text is what
 * prediction_answer.rationale stores. Nothing grades it, sends it to a model, echoes it in a response
 * or logs it. The Ask question keeps its own cleaning (explain/question.ts).
 */
import { RATIONALE_MAX_CHARS, RATIONALE_MIN_CHARS, checkRationale } from "@g-tee-oh/contracts";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";

/** Where the reason sits in the request, as validation problems name a field. */
const RATIONALE_PATH = "body.rationale";

/** The cleaned reason; a 400 validation problem naming body.rationale when the shared rule refuses it. */
export function requireRationale(rationale: string): string {
  const { cleaned, ready } = checkRationale(rationale);
  if (!ready) {
    const message = `Type a reason of at most ${RATIONALE_MAX_CHARS} characters with at least ${RATIONALE_MIN_CHARS} letters, numbers or punctuation marks.`;
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.validation, {
      detail: message,
      errors: [{ path: RATIONALE_PATH, message }],
    });
  }
  return cleaned;
}
