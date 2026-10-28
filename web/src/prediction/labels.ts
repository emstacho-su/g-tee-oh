/**
 * The quiz's fixed text (S27 lane A, S41, R3.16, O-301, O-410, O-412, O-414, A7 section 4):
 * headings, the level badge, the names of the hand regions and frequency bands, the result wording
 * and one fixed message per problem kind. A failure is always shown through problemText, so a
 * server detail never reaches the screen. Nothing here names a rating, score or grade label:
 * questions are unrated (05 section 8). The start screen's words live in quiz-text.ts.
 */
import { HTTP_STATUS, isApiProblem } from "../api/index.js";
import type { FrequencyBand, HandRegion, PredictionLadder } from "./types.js";

export const PREDICTION_SCOPE = "Quiz";
export const SUBMIT_KEY = "Enter";
export const NEXT_KEY = "n";
export const MAX_LEVEL = 3;

/** Whether the result belongs to a quiz (no unlocks, O-410) or an old drill-backed session. */
export type RunFlavor = "quiz" | "drill";

export const PREDICTION_TEXT = {
  heading: "Quizzes",
  intro: "Predict what the solver does before you see it. Answers are unrated and never change your rating.",
  starting: "Starting a quiz",
  loadingPrompt: "Loading the next question",
  submit: "Submit answer",
  submitting: "Checking your answer",
  next: "Next question",
  yes: "Yes",
  no: "No",
  percentLabel: "Share of the range, in percent",
  regionsLegend: "Regions with a mixed class",
  actionLegend: "Most frequent action",
  sizeLegend: "Most frequent size",
  bandLegend: "Frequency band",
  answerLegend: "Your answer",
  reasonLabel: "Your reason (required)",
  reasonHint: "Say why, in at least 3 characters. It is kept with your answer.",
  correct: "Correct",
  incorrect: "Not this time",
  unlocked: "Next level unlocked",
  stale: "This question moved on in another tab or window; here is the current one.",
  historyLabel: "Action so far",
  previous: "Previous",
  newer: "Newer",
  backToCurrent: "Back to current question",
  endQuiz: "End quiz",
  ending: "Ending the quiz",
  endFailed: "The quiz could not be ended. Try again.",
  yourReason: "Your reason",
} as const;

const LADDER_NAMES: Readonly<Record<PredictionLadder, string>> = { range: "Range", hand: "Hand" };
const DIFFICULTY_NAMES: readonly string[] = ["Easy", "Medium", "Hard"];

export const REGION_LABELS: Readonly<Record<HandRegion, string>> = {
  pairs: "Pairs",
  suited_aces: "Suited aces",
  suited_broadways: "Suited broadways",
  suited_connectors: "Suited connectors",
  suited_other: "Other suited hands",
  offsuit_aces: "Offsuit aces",
  offsuit_broadways: "Offsuit broadways",
  offsuit_other: "Other offsuit hands",
};

export const BAND_LABELS: Readonly<Record<FrequencyBand, string>> = {
  "0_25": "0 to 25 percent",
  "25_50": "25 to 50 percent",
  "50_75": "50 to 75 percent",
  "75_100": "75 to 100 percent",
};

/** "Range level 2 of 3". */
export function levelBadge(ladder: PredictionLadder, level: number): string {
  return `${LADDER_NAMES[ladder]} level ${level} of ${MAX_LEVEL}`;
}

/** "Next level unlocked: Range level 2 of 3". */
export function unlockedText(ladder: PredictionLadder, level: number): string {
  return `${PREDICTION_TEXT.unlocked}: ${levelBadge(ladder, level)}`;
}

/** "Passed Medium at this spot": the difficulty of the level the answer was given at (O-410). */
export function passedText(level: number): string {
  return `Passed ${DIFFICULTY_NAMES[level - 1] ?? DIFFICULTY_NAMES[0]} at this spot`;
}

/** "Last 20 at this level: 18 correct of 20 (90 percent ...)": what the window does for this run. */
export function windowText(window: { answers: number; correct: number; size: number; required_pct: number }, flavor: RunFlavor = "drill"): string {
  const meaning = flavor === "quiz" ? "passes this level" : "unlocks the next level";
  return `Last ${window.size} at this level: ${window.correct} correct of ${window.answers} (${window.required_pct} percent ${meaning})`;
}

const PROBLEM_TEXT = {
  notFound: "This quiz or its drill was not found. Start a new quiz.",
  ended: "This session has ended. Start a new quiz.",
  wrongMode: "This session is not a prediction session. Start a new quiz.",
  noCoverage: "The library has no solved spot for these choices yet. They were queued for the builder.",
  signedOut: "Your session expired. Sign in again.",
  unavailable: "The solver service did not answer. Try again in a moment.",
  invalid: "That answer could not be read. Check it and submit again.",
  fallback: "Something went wrong. Try again.",
} as const;

const SLUG_TEXT: Readonly<Record<string, string>> = {
  "session-ended": PROBLEM_TEXT.ended,
  "wrong-session-mode": PROBLEM_TEXT.wrongMode,
  "no-coverage": PROBLEM_TEXT.noCoverage,
};

const STATUS_TEXT: Readonly<Record<number, string>> = {
  [HTTP_STATUS.badRequest]: PROBLEM_TEXT.invalid,
  [HTTP_STATUS.unauthorized]: PROBLEM_TEXT.signedOut,
  [HTTP_STATUS.notFound]: PROBLEM_TEXT.notFound,
  [HTTP_STATUS.badGateway]: PROBLEM_TEXT.unavailable,
  [HTTP_STATUS.unavailable]: PROBLEM_TEXT.unavailable,
};

/** The fixed message for a failed request: by problem slug, then by status; never the server's detail. */
export function problemText(error: unknown): string {
  if (!isApiProblem(error)) return PROBLEM_TEXT.unavailable;
  return SLUG_TEXT[error.slug] ?? STATUS_TEXT[error.status] ?? PROBLEM_TEXT.fallback;
}
