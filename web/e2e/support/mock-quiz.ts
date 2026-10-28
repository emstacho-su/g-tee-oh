/**
 * The mocked api's quiz rules (S41, R3.16, O-410, O-411, O-412, O-415), kept apart from the
 * prediction routes (mock-prediction.ts) that use them.
 *
 * - startEntries: what a POST /sessions body for mode prediction starts over. An old drill start
 *   (no quiz options) walks every fixture prompt, as before. A catalog-spot start must pass the
 *   shared catalog check (mock-catalog-spot.ts) and carry valid quiz options (a known difficulty,
 *   one or two distinct question kinds); its prompts are the fixture prompts at the difficulty's
 *   level (Easy 1, Medium 2, Hard 3) on the chosen ladders, alternating in fixture order. Quiz
 *   options on a drill start are refused, as the api refuses them. A Hard quiz on hand questions
 *   only is a 422 no-quiz-questions (O-411 amended), so a shot can show that answer.
 * - rationaleProblem: the answer's reason as the api checks it, the schema first (a string of 1 to
 *   1,000 characters after trimming, else 400 validation), then the shared rule (rationaleReady
 *   from @g-tee-oh/contracts, else a 400 bad-request with the api's fixed detail). Either refusal
 *   names body.rationale in the problem's errors (REASON_FIELD_ERRORS, PR #39 review finding 3).
 * - recapFor: the recap of an ended quiz, which records nothing rated.
 */
import { RATIONALE_MAX_CHARS, rationaleReady } from "@g-tee-oh/contracts";

import type { SessionRecap } from "../../src/progress/types.js";
import { FIXTURE_PREDICTION_DRILL_ID, fixturePredictions, type FixturePrediction } from "../../src/fixtures/prediction.js";
import { CATALOG_PROBLEMS, catalogSpotProblem } from "./mock-catalog-spot.js";
import type { ProblemSpec } from "./mock-api.js";

export const QUIZ_PROBLEMS = {
  validation: CATALOG_PROBLEMS.validation,
  badRequest: { status: 400, slug: "bad-request", title: "Bad request" },
  notFound: { status: 404, slug: "not-found", title: "Not found" },
  noQuestions: { status: 422, slug: "no-quiz-questions", title: "No questions at this difficulty in these spots" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

export const SHORT_REASON_DETAIL = "Type a reason of at least 3 characters.";
const REASON_PATH = "body.rationale";
const REASON_MESSAGE = "The reason was not accepted";
/** The quiz the mock has no question for, so a shot can show no-quiz-questions: Hard on hand questions only. */
const NO_QUESTIONS_DIFFICULTY = "hard";
const NO_QUESTIONS_KINDS: readonly string[] = ["hand"];
const DIFFICULTY_LEVELS: Readonly<Record<string, number>> = { easy: 1, medium: 2, hard: 3 };
const KINDS: readonly string[] = ["range", "hand"];
const SEED_PATTERN = /^[0-9a-f]{16}$/;
const ENDED_AT = "2026-10-28T12:30:00Z";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quizEntries(quiz: unknown): readonly FixturePrediction[] | null {
  if (!isRecord(quiz)) return null;
  const level = DIFFICULTY_LEVELS[String(quiz["difficulty"])];
  const kinds = quiz["question_kinds"];
  const validKinds = Array.isArray(kinds) && kinds.length > 0 && new Set(kinds).size === kinds.length && kinds.every((kind) => KINDS.includes(String(kind)));
  if (level === undefined || !validKinds) return null;
  return fixturePredictions.filter((entry) => entry.prompt.level === level && (kinds as unknown[]).includes(entry.prompt.ladder));
}

/** The prompts a prediction start walks, or the problem it earns. */
export function startEntries(body: Record<string, unknown>): readonly FixturePrediction[] | ProblemSpec {
  const seed = body["seed"];
  if (seed !== undefined && (typeof seed !== "string" || !SEED_PATTERN.test(seed))) return QUIZ_PROBLEMS.validation;
  if (body["catalog_spot"] === undefined) {
    if (typeof body["drill_id"] !== "string" || body["quiz"] !== undefined) return QUIZ_PROBLEMS.validation;
    return body["drill_id"] === FIXTURE_PREDICTION_DRILL_ID ? fixturePredictions : QUIZ_PROBLEMS.notFound;
  }
  const entries = body["quiz"] === undefined ? fixturePredictions : quizEntries(body["quiz"]);
  if (entries === null) return QUIZ_PROBLEMS.validation;
  return catalogSpotProblem(body) ?? (asksNothing(body["quiz"]) ? QUIZ_PROBLEMS.noQuestions : entries);
}

/** True for the one quiz the mock answers no-quiz-questions to (O-411 amended): Hard, hand questions only. */
function asksNothing(quiz: unknown): boolean {
  if (!isRecord(quiz) || quiz["difficulty"] !== NO_QUESTIONS_DIFFICULTY) return false;
  const kinds = quiz["question_kinds"];
  return Array.isArray(kinds) && kinds.length === NO_QUESTIONS_KINDS.length && kinds.every((kind) => NO_QUESTIONS_KINDS.includes(String(kind)));
}

/** The problem a reason earns as the api checks it, or null when it is accepted. */
export function rationaleProblem(rationale: unknown): ProblemSpec | null {
  if (typeof rationale !== "string") return QUIZ_PROBLEMS.validation;
  const trimmed = rationale.trim();
  if (trimmed.length === 0 || trimmed.length > RATIONALE_MAX_CHARS) return QUIZ_PROBLEMS.validation;
  return rationaleReady(trimmed) ? null : QUIZ_PROBLEMS.badRequest;
}

/** The field errors a refused reason carries, naming body.rationale as the api does. */
export const REASON_FIELD_ERRORS: readonly { path: string; message: string }[] = [{ path: REASON_PATH, message: REASON_MESSAGE }];

export function recapFor(sessionId: string): SessionRecap {
  return {
    session_id: sessionId,
    ended_at: ENDED_AT,
    decisions: 0,
    rated_decisions: 0,
    mean_score: null,
    ev_loss_bb_total: 0,
    rating_changes: [],
    tier: null,
    unlocks: [],
  };
}
