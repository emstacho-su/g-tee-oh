/**
 * The /quiz address (S41, R3.16, O-410, O-411, O-415, O-419).
 *
 * Mechanism: the router keeps every query value a string (search-serialization.ts), so the quiz's
 * choice travels as config=<id>&positions=BTN,CO&spots=rfi,vs_open&kinds=range,hand&difficulty=easy
 * with an optional seed=<16 hex digits>, and an old drill-backed link as drill=<uuid>. Each value is
 * kept only in the shape the api accepts (a configuration id by the contract's pattern, known seats
 * and spot types, the two question kinds and the three difficulties, no repeats) and dropped
 * otherwise; the route component re-validates before the screen reads it, as /study does. A full
 * valid choice is what starts a quiz; a partial one fills the start screen. The old /predict address
 * keeps drill and seed, which mean the same on /quiz, and drops the rest (PM rule on O-419).
 */
import { CONFIG_ID_PATTERN } from "../store/session-defaults.js";
import type { Position } from "../contracts.js";
import { isPosition, isSpotType, type QuizOptions, type SpotType } from "./catalog-spot.js";
import { validatePracticeSearch, type PracticeSearch } from "./search.js";

export type QuizDifficulty = QuizOptions["difficulty"];
export type QuizKind = QuizOptions["question_kinds"][number];

export const QUIZ_DIFFICULTIES: readonly QuizDifficulty[] = ["easy", "medium", "hard"];
export const QUIZ_KINDS: readonly QuizKind[] = ["range", "hand"];
const LIST_SEPARATOR = ",";
const MAX_LIST_ITEMS = 9;

export interface QuizSearch extends PracticeSearch {
  config?: string;
  positions?: string;
  spots?: string;
  kinds?: string;
  difficulty?: string;
}

export interface QuizChoice {
  readonly config: string;
  readonly positions: readonly Position[];
  readonly spots: readonly SpotType[];
  readonly kinds: readonly QuizKind[];
  readonly difficulty: QuizDifficulty;
}

function isKind(value: string): value is QuizKind {
  return (QUIZ_KINDS as readonly string[]).includes(value);
}

function isDifficulty(value: unknown): value is QuizDifficulty {
  return typeof value === "string" && (QUIZ_DIFFICULTIES as readonly string[]).includes(value);
}

/** A comma list whose every item passes the check, with no repeats; undefined otherwise. */
function listOf<T extends string>(value: unknown, check: (item: string) => item is T): T[] | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const items = value.split(LIST_SEPARATOR);
  if (items.length > MAX_LIST_ITEMS || new Set(items).size !== items.length) return undefined;
  return items.every(check) ? items : undefined;
}

function keptList<T extends string>(value: unknown, check: (item: string) => item is T): string | undefined {
  return listOf(value, check)?.join(LIST_SEPARATOR);
}

export function validateQuizSearch(search: Record<string, unknown>): QuizSearch {
  const config = typeof search["config"] === "string" && CONFIG_ID_PATTERN.test(search["config"]) ? search["config"] : undefined;
  const entries: [keyof QuizSearch, string | undefined][] = [
    ["config", config],
    ["positions", keptList(search["positions"], isPosition)],
    ["spots", keptList(search["spots"], isSpotType)],
    ["kinds", keptList(search["kinds"], isKind)],
    ["difficulty", isDifficulty(search["difficulty"]) ? search["difficulty"] : undefined],
  ];
  const kept = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  return { ...validatePracticeSearch(search), ...kept };
}

/** The quiz choice of a validated address, or null while any part is missing. */
export function quizChoiceOf(search: QuizSearch): QuizChoice | null {
  const positions = listOf(search.positions, isPosition);
  const spots = listOf(search.spots, isSpotType);
  const kinds = listOf(search.kinds, isKind);
  const { config, difficulty } = search;
  if (config === undefined || positions === undefined || spots === undefined || kinds === undefined || !isDifficulty(difficulty)) return null;
  return { config, positions, spots, kinds, difficulty };
}

/** What a partial address already chose, for the start screen to fill in. */
export function partialQuizChoice(search: QuizSearch): Partial<QuizChoice> {
  const entries: [keyof QuizChoice, unknown][] = [
    ["config", search.config],
    ["positions", listOf(search.positions, isPosition)],
    ["spots", listOf(search.spots, isSpotType)],
    ["kinds", listOf(search.kinds, isKind)],
    ["difficulty", isDifficulty(search.difficulty) ? search.difficulty : undefined],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/** The address of a quiz choice, with the seed when there is one. */
export function quizSearchOf(choice: QuizChoice, seed: string | undefined): QuizSearch {
  return {
    config: choice.config,
    positions: choice.positions.join(LIST_SEPARATOR),
    spots: choice.spots.join(LIST_SEPARATOR),
    kinds: choice.kinds.join(LIST_SEPARATOR),
    difficulty: choice.difficulty,
    ...(seed === undefined ? {} : { seed }),
  };
}

/** The /quiz address an old /predict link lands on: drill and seed kept, everything else dropped. */
export function predictRedirectSearch(search: Record<string, unknown>): PracticeSearch {
  return validatePracticeSearch(search);
}
