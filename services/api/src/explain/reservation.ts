/**
 * What one Ask reserves against the monthly cap (R3.20, O-306): one place for the worst case, so
 * the reservation before the model calls (ask.ts) and the Ask button's state (status.ts) use the
 * same arithmetic (PR #29 review M8).
 *
 * A call's worst case is its prompt, estimated high (pricing.ts estimateInputTokens), plus
 * ASK_MAX_TOKENS of output; an Ask reserves MAX_MODEL_CALLS of them (the first answer and one
 * regeneration). The status does not know which attempt the next Ask is about, so it prices a
 * prompt at its bound: the instructions, a grounding of GROUNDING_CHARS_BOUND characters (a test
 * pins that the fixture groundings stay under it), the longest question and the regeneration
 * note. A real grounding is shorter, so the status says unavailable a little early rather than
 * enabling a button the cap would then refuse.
 */
import { ASK_QUESTION_MAX_CHARS } from "../schemas/explain.js";
import { type AskModel, worstCaseCents } from "./pricing.js";
import { ASK_MAX_TOKENS, MAX_MODEL_CALLS, REGENERATION_NOTE_MAX_CHARS, systemPrompt, userTurn } from "./prompt.js";

/** An upper bound on a grounding's canonical JSON, in characters (the fixtures are near 3,000). */
export const GROUNDING_CHARS_BOUND = 8000;

const ONE_CALL = 1;

/** The characters of the longest prompt one Ask can send for this grounding and question. */
export function askPromptChars(canonicalGrounding: string, question: string): number {
  return systemPrompt(canonicalGrounding).length + userTurn(question).length + REGENERATION_NOTE_MAX_CHARS;
}

/** The most one model call of an Ask can cost, in cents. */
export function callReservationCents(model: AskModel, promptChars: number): number {
  return worstCaseCents(model, promptChars, ASK_MAX_TOKENS, ONE_CALL);
}

/** The most a whole Ask (every call it may make) can cost, in cents. */
export function askReservationCents(model: AskModel, promptChars: number): number {
  return MAX_MODEL_CALLS * callReservationCents(model, promptChars);
}

/** The reservation the status assumes for the next Ask: the bounded prompt above. */
export function statusReservationCents(model: AskModel): number {
  const boundedPrompt = askPromptChars("x".repeat(GROUNDING_CHARS_BOUND), "x".repeat(ASK_QUESTION_MAX_CHARS));
  return askReservationCents(model, boundedPrompt);
}
