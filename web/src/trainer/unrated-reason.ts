/**
 * Why a decision is unrated, in one sentence beside the Unrated chip (S46, R3.13, 06 section 3.6,
 * O-272, O-276, O-288). Pure.
 *
 * The api decides the rated flag (learning's isRated through grading/decide.ts); this names the
 * cause from what the web was served, in a fixed order: a noise flag on the decision (R3.18), then
 * the session's mode (a drill, the holdout retest, an automated session started with a seed, all
 * never rated), then the prompt (a worked example, a panel that reveals the answer), and otherwise
 * a rating rule the web cannot see (the daily rated cap, a repeat attempt). A rated decision has
 * no reason.
 */
import type { DecisionFeedback, TrainerPrompt } from "../contracts.js";
import { revealsAnswer } from "./revealing-panels.js";
import type { PracticeSession } from "./session-types.js";

export const UNRATED_REASONS = {
  noise: "The spot is too close or too rare to score fairly, so it is graded for feedback only.",
  drill: "Drill sessions are never rated.",
  holdout: "The holdout retest is never rated.",
  seeded: "A session started with a seed is never rated.",
  workedExample: "Worked examples are never rated.",
  revealed: "A panel that shows the answer was on before the decision.",
  rule: "A rating rule left it out, for example the daily rated cap or a repeated spot.",
} as const;

export type UnratedReason = (typeof UNRATED_REASONS)[keyof typeof UNRATED_REASONS];

type FeedbackFacts = Pick<DecisionFeedback, "rated" | "noise_flags">;
type PromptFacts = Pick<TrainerPrompt, "worked_example" | "visible_panels">;
type SessionFacts = Pick<PracticeSession, "mode" | "rated_eligible">;

export function unratedReason(feedback: FeedbackFacts, prompt: PromptFacts, session: SessionFacts): UnratedReason | null {
  if (feedback.rated) return null;
  if (feedback.noise_flags.length > 0) return UNRATED_REASONS.noise;
  if (session.mode === "drill") return UNRATED_REASONS.drill;
  if (session.mode === "holdout") return UNRATED_REASONS.holdout;
  if (!session.rated_eligible) return UNRATED_REASONS.seeded;
  if (prompt.worked_example) return UNRATED_REASONS.workedExample;
  if (revealsAnswer(prompt.visible_panels)) return UNRATED_REASONS.revealed;
  return UNRATED_REASONS.rule;
}
