/**
 * The /study search parameters (S25, R3.12, O-286). The URL is the study screen's state, so a node
 * is linkable and browser back steps up the line.
 *
 * Mechanism: validateStudySearch keeps a value only when it has the shape the api accepts and
 * drops it otherwise, so a hand-edited URL never reaches the api as a malformed query; the screen
 * then asks for the missing filter instead of failing. The patterns mirror the contract's
 * (config_id, pair, line and hand in packages/contracts/api.openapi.json); the api validates again.
 */
import type { MatrixMode } from "../components/range-matrix/model.js";

export type StudyFormat = "online" | "live";

export interface StudySearch {
  format?: StudyFormat;
  table_size?: number;
  /** The stake's id (Stake.id). */
  stake?: string;
  /** The depth in centi-big-blinds (GameConfig.depth_cbb). */
  depth?: number;
  /** Two positions, out of position first, for example BB-BTN. */
  pair?: string;
  /** Dot-separated action tokens from the pair's root; absent is the root. */
  line?: string;
  mode?: MatrixMode;
  /** The selected hand class, for example AKs. */
  hand?: string;
  /** Compare to best (S45, R3.24, O-462): the compared action's NodeAction.index. */
  lens?: number;
  /** Action filters (S45, R3.12, O-468): a comma list of distinct NodeAction.index values, for example 0,2. */
  filters?: string;
}

export const STUDY_MODES: readonly MatrixMode[] = ["frequency", "ev", "weight", "strategy_ev", "compare"];
/** NodeAction.index is a byte in solver-query's record (ActionView.index: u8). */
export const MAX_ACTION_INDEX = 255;
/** Room for eight three-digit indexes: more actions than any node holds. */
export const MAX_FILTERS_LENGTH = 32;
const FILTERS_PATTERN = /^\d{1,3}(,\d{1,3})*$/;
export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 9;
/** Upper bound on a depth in centi-big-blinds (1,000 bb, the drill schema's depth limit). */
export const MAX_DEPTH_CBB = 100_000;
export const MAX_STAKE_ID_LENGTH = 64;
export const MAX_LINE_LENGTH = 256;

const PAIR_PATTERN = /^(UTG|UTG1|UTG2|LJ|HJ|CO|BTN|SB|BB)-(UTG|UTG1|UTG2|LJ|HJ|CO|BTN|SB|BB)$/;
const LINE_PATTERN = /^[a-z][0-9]*(\.[a-z][0-9]*)*$/;
const HAND_CLASS_PATTERN = /^(([2-9TJQKA])\2|[2-9TJQKA]{2}[so])$/;
const STAKE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function integerIn(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

function matching(value: unknown, pattern: RegExp, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength && pattern.test(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

/** A comma list of distinct action indexes within the byte range, else undefined. */
function filterList(value: unknown): string | undefined {
  const text = matching(value, FILTERS_PATTERN, MAX_FILTERS_LENGTH);
  if (text === undefined) return undefined;
  const indexes = text.split(",").map(Number);
  const distinct = new Set(indexes).size === indexes.length;
  return distinct && indexes.every((index) => index <= MAX_ACTION_INDEX) ? text : undefined;
}

/** The valid parameters of a /study URL; anything else is dropped. */
export function validateStudySearch(search: Record<string, unknown>): StudySearch {
  const entries: [keyof StudySearch, unknown][] = [
    ["format", oneOf(search["format"], ["online", "live"] as const)],
    ["table_size", integerIn(search["table_size"], MIN_TABLE_SIZE, MAX_TABLE_SIZE)],
    ["stake", matching(search["stake"], STAKE_ID_PATTERN, MAX_STAKE_ID_LENGTH)],
    ["depth", integerIn(search["depth"], 1, MAX_DEPTH_CBB)],
    ["pair", matching(search["pair"], PAIR_PATTERN, MAX_LINE_LENGTH)],
    ["line", matching(search["line"], LINE_PATTERN, MAX_LINE_LENGTH)],
    ["mode", oneOf(search["mode"], STUDY_MODES)],
    ["hand", matching(search["hand"], HAND_CLASS_PATTERN, MAX_LINE_LENGTH)],
    ["lens", integerIn(search["lens"], 0, MAX_ACTION_INDEX)],
    ["filters", filterList(search["filters"])],
  ];
  const kept: StudySearch = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  return kept;
}

/** The matrix mode when the URL names none (O-286). */
export const DEFAULT_STUDY_MODE: MatrixMode = "frequency";

/** The matrix mode the screen shows: the URL's, else the default. */
export function studyModeOf(search: StudySearch): MatrixMode {
  return search.mode ?? DEFAULT_STUDY_MODE;
}
