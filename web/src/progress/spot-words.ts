/**
 * One spot vocabulary for every screen (S47, R4.12, R3.4, R3.14, design rule 4, critic early
 * finding a): the words for an action family, a position, a position pair, a depth band, a format
 * and a configuration, so a class on the heat map, a leak row, a queue row, a coverage heading and
 * a drill's Spot column all name a spot the same way and no raw token ("rfi", "BB-BTN", a
 * configuration key) reaches the screen.
 *
 * Mechanism: pure maps and formatters over strings the api serves. A family or seat the maps do not
 * know keeps its text (never throws, never hides data). The pair's seats are written in the api's
 * order (out of position first, O-234); the web applies no ordering rule of its own (ADR 0004). A
 * configuration reads through configLabel when the catalog lists it and as a plain sentence
 * otherwise, never as its key.
 */
import { FORMAT_LABELS } from "../drills/labels.js";
import { CBB_PER_BB } from "../poker/format.js";
import { parsePair } from "../poker/pair.js";
import type { PreflopAction } from "../drills/types.js";
import { configLabel } from "../routes/settings/configs-query.js";
import type { GameConfig, HeatmapColumn, HeatmapRow } from "./types.js";

/** solver-query's action families (gto-model ActionFamily::as_str) in plain words, lower case for mid-sentence use. */
export const FAMILY_WORDS: Readonly<Record<string, string>> = {
  rfi: "open or fold",
  "facing-open": "facing an open",
  "facing-3bet": "facing a 3-bet",
  "facing-4bet": "facing a 4-bet",
  squeeze: "squeeze",
  "blind-vs-blind": "blind versus blind",
  "limped-isolation": "isolating a limper",
  "straddled-pot": "straddled pot",
};

export const UNKNOWN_FAMILY_WORDS = "preflop spot";

/** The drill builder's preflop_action values in the same words (R3.14, the Spot column). */
export const DRILL_ACTION_WORDS: Readonly<Record<PreflopAction, string>> = {
  rfi: "open or fold",
  vs_open: "facing an open",
  srp: "single-raised pot",
  three_bet: "3-betting",
  vs_three_bet: "facing a 3-bet",
  four_bet: "4-betting",
  squeeze: "squeeze",
  limp_iso: "isolating a limper",
  straddle: "straddled pot",
};

/** Every seat in preflop action order with its words (a label order, no arithmetic). */
export const POSITION_WORDS = {
  UTG: "under the gun",
  UTG1: "UTG+1",
  UTG2: "UTG+2",
  LJ: "lojack",
  HJ: "hijack",
  CO: "cutoff",
  BTN: "button",
  SB: "small blind",
  BB: "big blind",
} as const satisfies Readonly<Record<string, string>>;

const BAND_IN_BB = /^\d+$/;
const UNLISTED_CONFIGURATION = "a configuration the catalog does not list";
const LOADING_CONFIGURATION = "configuration loading";
const NOT_IN_CATALOG = "not in the catalog";

export function familyWords(family: string | null | undefined): string {
  return family === null || family === undefined ? UNKNOWN_FAMILY_WORDS : (FAMILY_WORDS[family] ?? UNKNOWN_FAMILY_WORDS);
}

export function drillActionWords(action: PreflopAction): string {
  return DRILL_ACTION_WORDS[action];
}

export function positionWords(seat: string): string {
  return (POSITION_WORDS as Readonly<Record<string, string>>)[seat] ?? seat;
}

/** "BB-BTN" reads "big blind versus button"; anything that is not two known seats keeps its text. */
export function pairWords(pair: string): string {
  const seats = parsePair(pair);
  if (seats === null) return pair;
  const [first, second] = seats;
  if (positionWords(first) === first || positionWords(second) === second) return pair;
  return `${positionWords(first)} versus ${positionWords(second)}`;
}

/** "100bb" for a numeric band (O-500: amounts write as "10bb"), the band itself ("short", "deep") otherwise. */
export function depthBandLabel(band: string): string {
  return BAND_IN_BB.test(band) ? `${band}bb` : band;
}

export function formatWords(format: string): string {
  return (FORMAT_LABELS as Readonly<Record<string, string>>)[format] ?? format;
}

export function capitalize(text: string): string {
  return text === "" ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A heat map column inside a sentence: "live 100bb"; the class words and the queue end with it. */
export function columnPhrase(column: Pick<HeatmapColumn, "format" | "depth_band">): string {
  return `${formatWords(column.format).toLowerCase()} ${depthBandLabel(column.depth_band)}`;
}

/** A heat map column as a header: "Live 100bb". */
export function columnWords(column: Pick<HeatmapColumn, "format" | "depth_band">): string {
  return capitalize(columnPhrase(column));
}

/** A heat map row: "Open or fold, big blind versus button". */
export function rowWords(row: Pick<HeatmapRow, "family" | "pair">): string {
  return `${capitalize(familyWords(row.family))}, ${pairWords(row.pair)}`;
}

/** A class: "Open or fold, big blind versus button, online 100bb". */
export function classWords(row: Pick<HeatmapRow, "family" | "pair">, column: Pick<HeatmapColumn, "format" | "depth_band">): string {
  return `${rowWords(row)}, ${columnPhrase(column)}`;
}

/** A configuration id's facets (table size, format, stake code, depth); the key is a readable id (db seed, CONFIG_ID_PATTERN). */
const CONFIG_ID_FACETS = /^cfg_([2-9])_(online|live)(?:_([a-z0-9]+))?_([0-9]+)(cbb)?(_straddle)?(?:_ante[0-9]+)?$/;

/**
 * An id the catalog does not list, in words from its own facets (PR #48 review round 2 MEDIUM 4):
 * "Live, 9 players, 100bb deep, stake code 13, not in the catalog", so two unlisted configurations
 * never read the same; the id itself only when it has no facets. The stake code stays a code: the
 * web holds no map from codes to blinds.
 */
function unlistedWords(id: string): string {
  const match = CONFIG_ID_FACETS.exec(id);
  if (match === null) return id;
  const [, size, format = "", stakeCode, depth = "", inCbb, straddle] = match;
  const depthBb = inCbb === undefined ? Number(depth) : Number(depth) / CBB_PER_BB;
  const parts = [
    formatWords(format),
    `${size} players`,
    `${depthBb}bb deep`,
    ...(stakeCode === undefined ? [] : [`stake code ${stakeCode}`]),
    ...(straddle === undefined ? [] : ["straddle"]),
  ];
  return `${parts.join(", ")}, ${NOT_IN_CATALOG}`;
}

/**
 * A configuration in words, never as its key: the catalog's label when it lists the configuration;
 * while the configuration list is still loading, a loading phrase; when the loaded catalog does not
 * list it, the id's own facets (unlistedWords), or a plain sentence without an id.
 */
export function configurationWords(config: GameConfig | undefined, id?: string, loading = false): string {
  if (config !== undefined) return configLabel(config);
  if (loading) return LOADING_CONFIGURATION;
  return id === undefined ? UNLISTED_CONFIGURATION : unlistedWords(id);
}

/** A configuration id in words through the list it is looked up in; undefined is a list still loading. */
export function configurationWordsIn(configs: readonly GameConfig[] | undefined, id: string): string {
  return configurationWords(configs?.find((config) => config.config_id === id), id, configs === undefined);
}
