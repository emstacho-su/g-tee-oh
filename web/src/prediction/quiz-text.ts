/**
 * The quiz start screen's words (S41, R3.16, O-350, O-410, O-411, O-416): the field names, the
 * option labels of the question kinds and difficulties, the line saying what each difficulty asks,
 * the note naming the seats the library has nothing for, the start card of a drill link, and the
 * sentence for a quiz with no question left (built from its choices, never the server's detail). The spot types' labels live with the
 * catalog spot (practice/catalog-spot.ts), since the painting picker shares them.
 */
import type { QuizDifficulty, QuizKind } from "../practice/quiz-search.js";

export const QUIZ_START_TEXT = {
  cardTitle: "Start a quiz",
  table: "Table",
  positions: "Positions",
  spotTypes: "Spot types",
  kinds: "Question kinds",
  difficulty: "Difficulty",
  levels: "Easy: over or under a share, and the highest-EV action. Medium: the share, and a frequency band. Hard: which regions mix, and the raise size played most.",
  start: "Start quiz",
  loadingTables: "Loading the tables",
  loadingSeats: "Loading the seats",
  noTables: "The library serves no table yet.",
} as const;

export const KIND_OPTIONS: readonly { value: QuizKind; label: string }[] = [
  { value: "range", label: "Range questions" },
  { value: "hand", label: "Hand questions" },
];

export const DIFFICULTY_OPTIONS: readonly { value: QuizDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

/** The start card a drill link shows (PR #39 security LOW 2: nothing starts until Start quiz). */
export const DRILL_QUIZ_TEXT = {
  title: "Start a quiz from a saved drill",
  body: "This link opens a quiz over a saved drill. Nothing starts until you press Start quiz.",
} as const;

const KIND_WORDS: Readonly<Record<QuizKind, string>> = { range: "range", hand: "hand" };

/**
 * The quiz's own words for a 422 no-quiz-questions (O-411 amended): the difficulty's name, and the
 * kind word only when exactly one kind was chosen. "No more Hard hand questions in these spots; try
 * more spot types or another difficulty."
 */
export function noQuestionsText(difficulty: QuizDifficulty, kinds: readonly QuizKind[]): string {
  const [only] = kinds;
  const kind = kinds.length === 1 && only !== undefined ? ` ${KIND_WORDS[only]}` : "";
  return `No more ${quizDifficultyName(difficulty)}${kind} questions in these spots; try more spot types or another difficulty.`;
}

/** "Hard" for hard: the name the start screen gives a difficulty. */
export function quizDifficultyName(difficulty: QuizDifficulty): string {
  return DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)?.label ?? difficulty;
}

/** "No solved spot yet for UTG, HJ, CO." or null when every seat is covered. */
export function uncoveredNote(seats: readonly string[]): string | null {
  return seats.length === 0 ? null : `No solved spot yet for ${seats.join(", ")}.`;
}
