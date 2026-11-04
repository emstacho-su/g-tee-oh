/**
 * Why a decision is unrated, in one sentence beside the Unrated chip (S46, R3.13, 06 section 3.6,
 * O-272, O-276, O-288). Pure.
 *
 * The api decides the rated flag (learning's isRated through grading/decide.ts); this names the
 * cause from what the web was served, in a fixed order: the session's mode first (a drill, the
 * holdout retest, an automated session started with a seed, all never rated, whatever the decision;
 * PR #45 review round 4, finding e), then a noise flag on the decision (R3.18), then the prompt (a
 * worked example, a panel that reveals the answer), and otherwise
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
type SessionFacts = Pick<PracticeSession, "mode" | "rated_eligible" | "automated">;

/**
 * A seeded automated session: the api's session view gives an automated session with its learning
 * data its block and rated_eligible = !seeded (services/api/src/sessions/session-view.ts), so only
 * that shape says "seeded"; any other ineligible session (no block, another mode) falls to the
 * generic rating-rule sentence (PR #45 review round 1, finding 7). The view carries no seed field.
 */
function isSeededAutomated(session: SessionFacts): boolean {
  return session.mode === "automated" && session.automated !== null && !session.rated_eligible;
}

export type PreDecisionSessionFacts = SessionFacts;

/** The session's own reason, the first in the ranked order, or null when the session alone does not settle it. */
function sessionReason(session: SessionFacts): UnratedReason | null {
  if (session.mode === "drill") return UNRATED_REASONS.drill;
  if (session.mode === "holdout") return UNRATED_REASONS.holdout;
  if (isSeededAutomated(session)) return UNRATED_REASONS.seeded;
  return null;
}

/** The prompt's own reason: a worked example, then a panel that reveals the answer; null for a plain prompt. */
function promptReason(prompt: PromptFacts): UnratedReason | null {
  if (prompt.worked_example) return UNRATED_REASONS.workedExample;
  if (revealsAnswer(prompt.visible_panels)) return UNRATED_REASONS.revealed;
  return null;
}

/** The session's ineligibility, after its mode and before the prompt: a rating rule the web cannot see. */
function eligibilityReason(session: SessionFacts): UnratedReason | null {
  return session.rated_eligible ? null : UNRATED_REASONS.rule;
}

export function unratedReason(feedback: FeedbackFacts, prompt: PromptFacts, session: SessionFacts): UnratedReason | null {
  if (feedback.rated) return null;
  const bySession = sessionReason(session);
  if (bySession !== null) return bySession;
  if (feedback.noise_flags.length > 0) return UNRATED_REASONS.noise;
  return eligibilityReason(session) ?? promptReason(prompt) ?? UNRATED_REASONS.rule;
}

/**
 * The reason the reveal notice gives before the decision, in the same ranked order as the chip
 * after it, so one session gives one reason (S48 round 5 verifier on street-next-hand and the
 * drill screens): the session's mode, then its ineligibility (the noise flag is not known before
 * the decision), then the prompt, the one order unratedReason applies (code review round 2, 5).
 * Shown only when the prompt itself leaves the decision unrated (RevealNotice decides that);
 * without session facts the prompt's reason stands.
 */
export function preDecisionReason(prompt: PromptFacts, session: SessionFacts | undefined): UnratedReason | null {
  const byPrompt = promptReason(prompt);
  if (byPrompt === null) return null;
  if (session === undefined) return byPrompt;
  return sessionReason(session) ?? eligibilityReason(session) ?? byPrompt;
}
