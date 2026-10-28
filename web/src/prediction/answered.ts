/**
 * The answered list behind the quiz's Previous (S41, R3.16, O-414).
 *
 * Mechanism: each answered prompt is kept as the player saw and sent it: the prompt as shown, the
 * answer draft, the typed reason and the api's result. The list lives only in the run's client
 * state (use-prediction-run.ts), newest last, capped at MAX_ANSWERED by dropping the oldest; it is
 * never written anywhere or read back from the api, so a reload, End quiz or a sign-out loses it.
 * Every function returns a new value and never changes its input.
 */
import type { PredictionPrompt, PredictionResult } from "../contracts.js";
import type { AnswerDraft } from "./draft.js";

/** The most answered prompts a run keeps for review (O-414). */
export const MAX_ANSWERED = 50;

export interface AnsweredItem {
  readonly prompt: PredictionPrompt;
  readonly draft: AnswerDraft;
  readonly reason: string;
  readonly result: PredictionResult;
}

/** The list with one more item at the end, keeping the newest MAX_ANSWERED. */
export function appendAnswered(list: readonly AnsweredItem[], item: AnsweredItem): readonly AnsweredItem[] {
  const next = [...list, item];
  return next.length > MAX_ANSWERED ? next.slice(next.length - MAX_ANSWERED) : next;
}

/** The review index one step older (-1) or newer (+1), held between the oldest and the newest. */
export function reviewStep(index: number, length: number, step: -1 | 1): number {
  return Math.min(Math.max(index + step, 0), Math.max(length - 1, 0));
}
