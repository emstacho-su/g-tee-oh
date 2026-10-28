/**
 * The study filters (S25, R3.12, O-286): the choices each select offers, how a format, table size,
 * stake and depth resolve to one config_id, and the search updates a filter change makes.
 *
 * Mechanism: every function is pure over the catalog lists the api sent (formatConfigsQuery,
 * stakesQuery, pairsQuery in queries.ts) and the URL's StudySearch. The filters form a chain,
 * format, table size, stake, depth, pair: a change clears the filters below it (a depth change
 * keeps the pair, since the same pair usually exists at every depth), and every filter change
 * clears the line and the selected hand, which belong to the old node. Updates go through
 * validateStudySearch, so a value that is not a valid parameter is dropped, never sent. Pairs
 * without a published preflop solution stay visible but disabled, labeled "Not in the library";
 * requesting coverage is the library screen's job (S28, ADR 0018). Depths print in big blinds
 * through formatCbb, a display format only (ADR 0004).
 */
import { formatCbb } from "../poker/format.js";
import type { GameConfig, PositionPairEntry, Stake } from "./queries.js";
import { validateStudySearch, type StudyFormat, type StudySearch } from "./search.js";
import type { MatrixMode } from "../components/range-matrix/model.js";

export const FILTER_KEYS = ["format", "table_size", "stake", "depth", "pair"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** The two formats; shared with the study settings panel (settings.ts, S39). */
export const FORMAT_OPTIONS: readonly (SelectOption & { readonly value: StudyFormat })[] = [
  { value: "online", label: "Online" },
  { value: "live", label: "Live" },
];

/** What the screen says when a filter is the next one to choose. */
export const FILTER_PROMPTS: Readonly<Record<FilterKey, string>> = {
  format: "Choose a format to start.",
  table_size: "Choose a table size.",
  stake: "Choose a stake.",
  depth: "Choose a stack depth.",
  pair: "Choose a pair to open its root node.",
};

export const NOT_IN_LIBRARY = "Not in the library";

/** Filters a depth change keeps; every other change clears all filters below it. */
const KEPT_BELOW: Readonly<Partial<Record<FilterKey, readonly FilterKey[]>>> = { depth: ["pair"] };
/** Parameters that belong to one node and go whenever a filter changes. */
const NODE_KEYS: readonly (keyof StudySearch)[] = ["line", "hand"];

/** The distinct values, ascending; shared with settings.ts (S39). */
export function distinctSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function tableSizeOptions(configs: readonly GameConfig[]): SelectOption[] {
  return distinctSorted(configs.map((config) => config.table_size)).map((size) => ({
    value: String(size),
    label: `${size} players`,
  }));
}

/** The format's stakes, in the api's order, that have a configuration at this table size. */
export function stakeOptions(stakes: readonly Stake[], configs: readonly GameConfig[], tableSize: number): SelectOption[] {
  const stakeIds = new Set(configs.filter((config) => config.table_size === tableSize).map((config) => config.stake_id));
  return stakes.filter((stake) => stakeIds.has(stake.id)).map((stake) => ({ value: stake.id, label: stake.label }));
}

export function depthOptions(configs: readonly GameConfig[], tableSize: number, stakeId: string): SelectOption[] {
  const depths = configs
    .filter((config) => config.table_size === tableSize && config.stake_id === stakeId)
    .map((config) => config.depth_cbb);
  return distinctSorted(depths).map((depth) => ({ value: String(depth), label: formatCbb(depth) }));
}

/**
 * The config_id the four filters name, or undefined when one is missing or nothing matches. A
 * straddle variant at the same depth loses to the plain one; the straddle filter arrives with the
 * live straddle configurations (O-33).
 */
export function resolveConfigId(configs: readonly GameConfig[], search: StudySearch): string | undefined {
  const { format, table_size: tableSize, stake, depth } = search;
  if (format === undefined || tableSize === undefined || stake === undefined || depth === undefined) return undefined;
  const matching = configs.filter(
    (config) =>
      config.format === format && config.table_size === tableSize && config.stake_id === stake && config.depth_cbb === depth,
  );
  return (matching.find((config) => !config.straddle) ?? matching[0])?.config_id;
}

export function pairOptions(pairs: readonly PositionPairEntry[]): SelectOption[] {
  return pairs.map((entry) => ({
    value: entry.pair,
    label: entry.preflop_available ? entry.pair : `${entry.pair} (${NOT_IN_LIBRARY})`,
    disabled: !entry.preflop_available,
  }));
}

/** The first filter the user still has to choose, or null when the config and pair are known. */
export function missingFilter(search: StudySearch, configId: string | undefined): FilterKey | null {
  if (search.format === undefined) return "format";
  if (search.table_size === undefined) return "table_size";
  if (search.stake === undefined) return "stake";
  if (search.depth === undefined || configId === undefined) return "depth";
  return search.pair === undefined ? "pair" : null;
}

function without(search: StudySearch, keys: readonly (keyof StudySearch)[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(search).filter(([key]) => !keys.includes(key as keyof StudySearch)));
}

/** The search after a filter select changes to raw ("" clears that filter). */
export function withFilter(search: StudySearch, key: FilterKey, raw: string): StudySearch {
  const below = FILTER_KEYS.slice(FILTER_KEYS.indexOf(key) + 1);
  const kept = KEPT_BELOW[key] ?? [];
  const cleared = [key, ...below.filter((filter) => !kept.includes(filter)), ...NODE_KEYS];
  const base = without(search, cleared);
  return validateStudySearch(raw === "" ? base : { ...base, [key]: raw });
}

/** The search at another line of the same pair; "" is the root. The hand stays selected. */
export function withLine(search: StudySearch, line: string): StudySearch {
  const base = without(search, ["line"]);
  return validateStudySearch(line === "" ? base : { ...base, line });
}

export function withMode(search: StudySearch, mode: MatrixMode): StudySearch {
  return { ...search, mode };
}

export function withHand(search: StudySearch, hand: string): StudySearch {
  return validateStudySearch({ ...search, hand });
}
