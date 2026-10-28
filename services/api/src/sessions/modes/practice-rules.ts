/**
 * The body rules of POST /sessions that span fields S41 added (R3.16, R3.17, O-410, O-415), checked
 * before any database or solver-query call, so a refused body writes nothing:
 * - prediction and range_paint take exactly one of drill_id or catalog_spot (the drill path names
 *   the missing one itself, modes/drill.ts);
 * - drill, automated and holdout refuse catalog_spot;
 * - only prediction takes quiz.
 * Each is a 400 bad-request problem with a fixed detail.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import { levelOfDifficulty, type QuizOptions } from "../../schemas/practice-start.js";
import type { SessionCreateBody } from "../session-call.js";
import type { QuizState } from "../state.js";

const PRACTICE_MODES: readonly string[] = ["prediction", "range_paint"];

function badRequest(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, { detail });
}

/** Throws the 400 for a body whose S41 fields do not fit its mode. */
export function checkPracticeStartRules(body: SessionCreateBody): void {
  const practice = PRACTICE_MODES.includes(body.mode);
  if (body.catalog_spot !== undefined && !practice) {
    throw badRequest(`A ${body.mode} session does not take catalog_spot.`);
  }
  if (body.catalog_spot !== undefined && body.drill_id !== undefined) {
    throw badRequest("Send drill_id or catalog_spot, not both.");
  }
  if (body.quiz !== undefined && body.mode !== "prediction") {
    throw badRequest("Only a prediction session takes quiz.");
  }
}

/** The quiz state a body's quiz options set (O-410, O-411); undefined without them. */
export function quizStateOf(quiz: QuizOptions | undefined): QuizState | undefined {
  if (quiz === undefined) {
    return undefined;
  }
  return { level: levelOfDifficulty(quiz.difficulty), ladders: [...quiz.question_kinds] };
}
