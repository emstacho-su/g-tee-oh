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

const FORMAT_WORDS: Readonly<Record<string, string>> = { online: "Online", live: "Live" };
const PAIR_SEPARATOR = "-";
const PAIR_SEATS = 2;
const BAND_IN_BB = /^\d+$/;
const UNLISTED_CONFIGURATION = "a configuration the catalog does not list";

export function familyWords(family: string | null | undefined): string {
  return family === null || family === undefined ? UNKNOWN_FAMILY_WORDS : (FAMILY_WORDS[family] ?? UNKNOWN_FAMILY_WORDS);
}

export function drillActionWords(action: PreflopAction): string {
  return DRILL_ACTION_WORDS[action];
}

export function positionWords(seat: string): string {
  return (POSITION_WORDS as Readonly<Record<string, string>>)[seat] ?? seat;
}

/** "BB-BTN" reads "big blind versus button"; anything that is not two seats keeps its text. */
export function pairWords(pair: string): string {
  const seats = pair.split(PAIR_SEPARATOR);
  if (seats.length !== PAIR_SEATS) return pair;
  const [first, second] = seats;
  if (first === undefined || second === undefined || positionWords(first) === first || positionWords(second) === second) return pair;
  return `${positionWords(first)} versus ${positionWords(second)}`;
}

/** "100bb" for a numeric band (O-500: amounts write as "10bb"), the band itself ("short", "deep") otherwise. */
export function depthBandLabel(band: string): string {
  return BAND_IN_BB.test(band) ? `${band}bb` : band;
}

export function formatWords(format: string): string {
  return FORMAT_WORDS[format] ?? format;
}

export function capitalize(text: string): string {
  return text === "" ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A heat map column: "Online 100bb". */
export function columnWords(column: Pick<HeatmapColumn, "format" | "depth_band">): string {
  return `${formatWords(column.format)} ${depthBandLabel(column.depth_band)}`;
}

/** A heat map row: "Open or fold, big blind versus button". */
export function rowWords(row: Pick<HeatmapRow, "family" | "pair">): string {
  return `${capitalize(familyWords(row.family))}, ${pairWords(row.pair)}`;
}

/** A class: "Open or fold, big blind versus button, online 100bb". */
export function classWords(row: Pick<HeatmapRow, "family" | "pair">, column: Pick<HeatmapColumn, "format" | "depth_band">): string {
  return `${rowWords(row)}, ${column.format} ${depthBandLabel(column.depth_band)}`;
}

/** The catalog's label for a configuration, or a plain sentence when the catalog does not list it; never the key. */
export function configurationWords(config: GameConfig | undefined): string {
  return config === undefined ? UNLISTED_CONFIGURATION : configLabel(config);
}
