/**
 * The quiz start screen's words (S41, R3.16, O-350, O-410, O-411, O-416): the field names, the
 * option labels of the question kinds and difficulties, the line saying what each difficulty asks
 * and the note naming the seats the library has nothing for. The spot types' labels live with the
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

/** "No solved spot yet for UTG, HJ, CO." or null when every seat is covered. */
export function uncoveredNote(seats: readonly string[]): string | null {
  return seats.length === 0 ? null : `No solved spot yet for ${seats.join(", ")}.`;
}
