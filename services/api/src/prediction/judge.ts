/**
 * Judging a prediction answer against the question's truth (R3.16, O-301, ADR 0004). Every rule is
 * a comparison with a Rust number or flag held in the question's truth:
 * - yes_no: (share above the threshold) equals the answer;
 * - percent: within PERCENT_TOLERANCE_PCT points of the share;
 * - regions: the chosen set equals the truth's set (order and repeats ignored);
 * - action and size: the chosen index is one of the truth's indexes (ties all count);
 * - band: the chosen band is the truth's band.
 * An answer of another kind than the question asks, or an action the question does not offer, is a
 * 400 problem: the request is malformed for this prompt, and nothing is recorded.
 */
import type { z } from "zod";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { predictionAnswerSchema } from "../schemas/prediction.js";
import type { SqNode } from "../solver-query/client.js";
import { isAggressive, type PredictionQuestion } from "./question.js";
import { PERCENT_TOLERANCE_PCT } from "./range-questions.js";

export type PredictionAnswer = z.infer<typeof predictionAnswerSchema>;

function badAnswer(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail });
}

function requireTruth<T>(value: T | null): T {
  if (value === null) {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "The prompt's truth is incomplete." });
  }
  return value;
}

function sameSet(chosen: readonly string[], truth: readonly string[]): boolean {
  const picked = new Set(chosen);
  return picked.size === truth.length && truth.every((entry) => picked.has(entry));
}

function requireOffered(node: SqNode, index: number, aggressiveOnly: boolean): void {
  const action = node.actions.find((entry) => entry.index === index);
  if (action === undefined || (aggressiveOnly && !isAggressive(action))) {
    throw badAnswer("The answer names an action this prompt does not offer.");
  }
}

/** True when the answer matches the question's truth; a 400 problem for an answer that does not fit the prompt. */
export function judgeAnswer(question: PredictionQuestion, node: SqNode, answer: PredictionAnswer): boolean {
  if (answer.kind !== question.answer_kind) {
    throw badAnswer(`This prompt asks for an answer of kind ${question.answer_kind}.`);
  }
  const { truth } = question;
  switch (answer.kind) {
    case "yes_no":
      return requireTruth(truth.share_pct) > requireTruth(question.threshold_pct) === answer.value;
    case "percent":
      return Math.abs(answer.value - requireTruth(truth.share_pct)) <= PERCENT_TOLERANCE_PCT;
    case "regions":
      return sameSet(answer.value, requireTruth(truth.regions));
    case "action":
      requireOffered(node, answer.action_index, false);
      return requireTruth(truth.action_indexes).includes(answer.action_index);
    case "size":
      requireOffered(node, answer.action_index, true);
      return requireTruth(truth.action_indexes).includes(answer.action_index);
    case "band":
      return answer.band === requireTruth(truth.band);
  }
}
