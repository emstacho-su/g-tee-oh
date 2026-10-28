/**
 * The quiz answer's typed reason at the boundary (R3.16, S41, O-350, O-412). The body schema has
 * trimmed it and capped it at RATIONALE_MAX_CHARS; here it is cleaned by the one rule the web applies
 * before it enables Submit (@g-tee-oh/contracts rationale.ts, PR #39 review finding 3): NFC,
 * default-ignorable code points removed, control and format characters as spaces, whitespace
 * collapsed. A reason with fewer than RATIONALE_MIN_CHARS visible characters (letters, numbers,
 * punctuation) is a 400 validation problem naming body.rationale, before anything is judged or
 * written, so a reason that only looks typed is refused (security review LOW 1). The cleaned text is
 * what prediction_answer.rationale stores. Nothing grades it, sends it to a model, echoes it in a
 * response or logs it. The Ask question keeps its own cleaning (explain/question.ts).
 */
import { RATIONALE_MIN_CHARS, cleanRationale, visibleRationaleChars } from "@g-tee-oh/contracts";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";

/** Where the reason sits in the request, as validation problems name a field. */
const RATIONALE_PATH = "body.rationale";

/** The cleaned reason; a 400 validation problem naming body.rationale when too few visible characters are left. */
export function requireRationale(rationale: string): string {
  if (visibleRationaleChars(rationale) < RATIONALE_MIN_CHARS) {
    const message = `Type a reason with at least ${RATIONALE_MIN_CHARS} letters, numbers or punctuation marks.`;
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.validation, {
      detail: message,
      errors: [{ path: RATIONALE_PATH, message }],
    });
  }
  return cleanRationale(rationale);
}
