/**
 * Fixed texts of More info and Ask (S27 lane D, S38, R3.19, R3.20, O-305 to O-308, O-388). More
 * info is the feedback panel's inline Explanation section since S38; Ask keeps its dialog.
 *
 * Mechanism: the Ask button is disabled with a visible reason whenever GET /explain/status says
 * Ask is unavailable; the reason comes from the status's reason field (flag_off while no model key
 * is configured, O-305; cap_reached once this month's spend reached the cap, O-306). A POST that
 * still meets the same refusal (the 503 ask-disabled or 429 ask-cap-reached problem, O-307) maps to
 * the same two texts, so the user reads one sentence per cause wherever it surfaces. Server detail
 * text is never shown.
 */
import { isAskCapReached, isAskDisabled } from "../api/problem-kinds.js";
import type { AskStatus } from "../contracts.js";

/** The api's question limit (askBodySchema in services/api/src/schemas/explain.ts, PM3). */
export const ASK_QUESTION_MAX_CHARS = 500;

export const EXPLAIN_TEXT = {
  moreInfo: "More info",
  /** The feedback panel's inline section that holds More info's template sections (S38, O-388). */
  explanation: "Explanation",
  moreInfoLoading: "Loading the explanation",
  moreInfoSubject: "The explanation",
  moreInfoRetry: "Retry the explanation",
  moreInfoEmpty: "There is no explanation for this decision.",
  ask: "Ask",
  askTitle: "Ask about this decision",
  askDescription: "The answer may only use the solver's numbers and hands for this spot.",
  questionLabel: "Your question",
  send: "Send question",
  sending: "Waiting for the answer",
  answerSubject: "The answer",
  cachedNote: "From the cache",
  warningPrefix: "Warning:",
  statusLoading: "Checking whether Ask is available",
  statusSubject: "The Ask status",
  statusRetry: "Retry the Ask status",
  flagOff: "Ask is off until a model key is configured",
  capReached: "This month's Ask budget is used",
  unavailable: "Ask is not available right now",
  /** The api's own warning text, used when an unvalidated answer arrives without one (O-308). */
  unvalidated: "Some numbers in this answer could not be checked against the solver data.",
} as const;

const REASON_TEXT: Readonly<Record<AskStatus["reason"], string>> = {
  ok: EXPLAIN_TEXT.unavailable,
  flag_off: EXPLAIN_TEXT.flagOff,
  cap_reached: EXPLAIN_TEXT.capReached,
};

/** Why Ask is unavailable, or null when the button may be used. */
export function askUnavailableText(status: AskStatus): string | null {
  return status.available ? null : REASON_TEXT[status.reason];
}

/** The fixed text for an Ask refusal problem, or null for any other failure. */
export function askProblemText(error: unknown): string | null {
  if (isAskDisabled(error)) return EXPLAIN_TEXT.flagOff;
  if (isAskCapReached(error)) return EXPLAIN_TEXT.capReached;
  return null;
}

/** The counter under the question box. */
export function questionCounterText(length: number): string {
  return `${length} of ${ASK_QUESTION_MAX_CHARS} characters`;
}
