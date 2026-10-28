/**
 * What a quiz may ask (R3.16, S41, O-410, O-411 amended by the PR #39 review, finding 2): a quiz never
 * downgrades its level and never asks a ladder the user did not choose. A node that cannot ask the
 * quiz's level on any chosen ladder is skipped: the quiz start keeps only the hero spots that can
 * (canAskQuiz, applied in the spot search, so no extra solver-query read), and a quiz whose spots can
 * ask nothing is refused, at the start or at a prompt, with the no-quiz-questions problem.
 *
 * Questions are built at the exact level (exactLevel): the hand ladder's level 3 tries the other held
 * hands before giving up, and neither ladder falls back to level 2. The draws only pick among what can
 * be asked, so canAskQuiz checks with zero draws.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { SqNode } from "../solver-query/client.js";
import type { QuizState } from "../sessions/state.js";
import { handQuestion } from "./hand-questions.js";
import type { PredictionLadder, PredictionQuestion, QuestionDraws } from "./question.js";
import { rangeQuestion } from "./range-questions.js";

/** The difficulty names, by level (O-410). */
const DIFFICULTY_NAMES: Readonly<Record<number, string>> = { 1: "Easy", 2: "Medium", 3: "Hard" };
const NO_DRAWS: QuestionDraws = { hand: 0n, threshold: 0n };

/** A quiz's question on one ladder at its exact level; undefined when the node cannot ask it. */
export function quizQuestion(node: SqNode, ladder: PredictionLadder, level: number, draws: QuestionDraws): PredictionQuestion | undefined {
  const input = { node, level, draws, exactLevel: true };
  return ladder === "range" ? rangeQuestion(input) : handQuestion(input);
}

/** True when the node can ask the quiz's level on at least one of its chosen ladders. */
export function canAskQuiz(node: SqNode, quiz: QuizState): boolean {
  return quiz.ladders.some((ladder) => quizQuestion(node, ladder, quiz.level, NO_DRAWS) !== undefined);
}

/** 422 no-quiz-questions: "No more Hard hand questions in these spots; ..." (the kind only when one was chosen). */
export function noQuizQuestionsProblem(quiz: QuizState): ProblemError {
  const difficulty = DIFFICULTY_NAMES[quiz.level] ?? `Level ${quiz.level}`;
  const kind = quiz.ladders.length === 1 ? ` ${quiz.ladders[0] ?? ""}` : "";
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noQuizQuestions, {
    detail: `No more ${difficulty}${kind} questions in these spots; try more spot types or another difficulty.`,
  });
}
