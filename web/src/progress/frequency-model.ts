/**
 * The words and numbers of the frequency card (S41, R4.12, O-353, O-417, O-418). Pure: no input,
 * output or clock, and every function returns a new value.
 *
 * Mechanism: a spot is named only from the response's fields (the hero seat, the action family in
 * words, the pair and the configuration), never by reading node_key or spot_class_key, which are
 * opaque. When the configuration list is loaded the configuration takes its label (settings'
 * configLabel), else its id; two spots that would share a name are numbered. Shares are the api's
 * 0 to 1 fractions written as whole percents. The gap of a row is its largest difference between
 * your share and the solver's; the api already sorts the hand rows by it, so the card keeps the
 * api's order and the gap is only read, never used to reorder.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

import { configLabel } from "../routes/settings/configs-query.js";
import { formatPercent } from "./format.js";
import type { GameConfig } from "./types.js";

type Schemas = ApiComponents["schemas"];

export type FrequencyComparison = Schemas["FrequencyComparison"];
export type SpotFrequency = Schemas["SpotFrequency"];
export type HandFrequency = Schemas["HandFrequency"];
export type FrequencyRow = Schemas["FrequencyRow"];

export interface SpotOption {
  readonly value: string;
  readonly label: string;
}

/** solver-query's action families (gto-model ActionFamily::as_str) in plain words. */
const FAMILY_WORDS: Readonly<Record<string, string>> = {
  rfi: "open",
  "facing-open": "facing an open",
  "facing-3bet": "facing a 3-bet",
  "facing-4bet": "facing a 4-bet",
  squeeze: "squeeze",
  "blind-vs-blind": "blind versus blind",
  "limped-isolation": "isolating a limper",
  "straddled-pot": "straddled pot",
};
const UNKNOWN_FAMILY = "preflop spot";
const FIRST_DUPLICATE_NUMBER = 2;

export function familyWords(family: string | null): string {
  return family === null ? UNKNOWN_FAMILY : (FAMILY_WORDS[family] ?? UNKNOWN_FAMILY);
}

function spotName(spot: SpotFrequency, configs: readonly GameConfig[] | undefined): string {
  const config = configs?.find((entry) => entry.config_id === spot.config_id);
  const table = config === undefined ? spot.config_id : configLabel(config);
  return `${spot.hero_position} ${familyWords(spot.action_family)} (${spot.pair}), ${table}`;
}

/** One select option per spot, in the api's order, every label distinct. */
export function spotOptions(spots: readonly SpotFrequency[], configs: readonly GameConfig[] | undefined): SpotOption[] {
  const names = spots.map((spot) => spotName(spot, configs));
  return spots.map((spot, index) => {
    const name = names[index] ?? spot.node_key;
    const earlier = names.slice(0, index).filter((other) => other === name).length;
    return { value: spot.node_key, label: earlier === 0 ? name : `${name} (${earlier + FIRST_DUPLICATE_NUMBER - 1})` };
  });
}

/** "38%" from 0.384. */
export function percentText(share: number): string {
  return formatPercent(share);
}

/** The largest difference between your share and the solver's over a row's actions. */
export function largestGap(row: FrequencyRow): number {
  return row.your_freq.reduce((largest, yours, index) => Math.max(largest, Math.abs(yours - (row.solver_freq[index] ?? 0))), 0);
}

/** "12 of 30 decisions at this spot". */
export function sampleText(decisions: number, minimum: number): string {
  return `${decisions} of ${minimum} decisions at this spot`;
}
