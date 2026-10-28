/**
 * The quiz answer's typed reason at the boundary (R3.16, S41, O-350, O-412). The body schema has
 * trimmed it and capped it at RATIONALE_MAX_CHARS; here it is cleaned by the rule the Ask question
 * shares (http/free-text.ts), and a reason shorter than RATIONALE_MIN_CHARS once cleaned is a 400
 * before anything is judged or written. The cleaned text is what prediction_answer.rationale
 * stores. Nothing grades it, sends it to a model, echoes it in a response or logs it.
 */
import { cleanFreeText } from "../http/free-text.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { RATIONALE_MIN_CHARS } from "../schemas/prediction.js";

/** The cleaned reason; a 400 bad-request problem when fewer than RATIONALE_MIN_CHARS are left. */
export function requireRationale(rationale: string): string {
  const cleaned = cleanFreeText(rationale);
  if ([...cleaned].length < RATIONALE_MIN_CHARS) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
      detail: `Type a reason of at least ${RATIONALE_MIN_CHARS} characters.`,
    });
  }
  return cleaned;
}
