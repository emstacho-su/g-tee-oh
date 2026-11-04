/**
 * The words and numbers of the frequency card (S41, R4.12, O-353, O-417, O-418). Pure: no input,
 * output or clock, and every function returns a new value.
 *
 * Mechanism: a spot is named only from the response's fields (the hero seat, the action family in
 * words, the pair and the configuration), never by reading node_key or spot_class_key, which are
 * opaque, all through the shared spot vocabulary (spot-words.ts, S47). When the configuration list
 * is loaded the configuration takes its label, else a plain sentence (never its key); two spots that would share a name are numbered. A spot is keyed by
 * its solution and node (spotKey), since a rebuilt node keeps its node_key under a new solution
 * (PR #39 review finding 6). The api already sorts the hand rows by their largest gap, so the card
 * keeps the api's order; shares are written with the progress format's formatPercent. Since the
 * S47 follow-up (R4.12) each action's gap reads in points (gapSentence): the difference of the two
 * shares the api served, rounded to a whole point, and nothing else.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

import { capitalize, configurationWordsIn, familyWords, pairWords, positionWords } from "./spot-words.js";
import type { GameConfig } from "./types.js";

type Schemas = ApiComponents["schemas"];

export type FrequencyComparison = Schemas["FrequencyComparison"];
export type SpotFrequency = Schemas["SpotFrequency"];
export type HandFrequency = Schemas["HandFrequency"];
export type FrequencyRow = Schemas["FrequencyRow"];

export interface SpotOption {
  readonly value: string;
  readonly label: string;
  /** The configuration id, as the option's tooltip. */
  readonly title: string;
}

const FIRST_DUPLICATE_NUMBER = 2;
/** A solution id is a uuid, so this never occurs inside one. */
const SPOT_KEY_SEPARATOR = "|";

/** The family words are the shared spot vocabulary (spot-words.ts, S47); kept here for the card's callers. */
export { familyWords };

function spotName(spot: SpotFrequency, configs: readonly GameConfig[] | undefined): string {
  // A loading phrase until the list lands; an unlisted id by its own facets, never the bare key (round 2 MEDIUM 4).
  const table = configurationWordsIn(configs, spot.config_id);
  return `${capitalize(familyWords(spot.action_family))} as ${positionWords(spot.hero_position)} (${pairWords(spot.pair)}), ${table}`;
}

/**
 * A spot's identity: its solution and its node (PR #39 review finding 6). A rebuilt node keeps its
 * node_key under a new solution, so the node_key alone can name two spots.
 */
export function spotKey(spot: Pick<SpotFrequency, "solution_id" | "node_key">): string {
  return `${spot.solution_id}${SPOT_KEY_SEPARATOR}${spot.node_key}`;
}

/** One select option per spot, in the api's order, every label distinct. */
export function spotOptions(spots: readonly SpotFrequency[], configs: readonly GameConfig[] | undefined): SpotOption[] {
  const names = spots.map((spot) => spotName(spot, configs));
  return spots.map((spot, index) => {
    const name = names[index] ?? spot.node_key;
    const earlier = names.slice(0, index).filter((other) => other === name).length;
    return { value: spotKey(spot), label: earlier === 0 ? name : `${name} (${earlier + FIRST_DUPLICATE_NUMBER - 1})`, title: spot.config_id };
  });
}

const POINTS_PER_SHARE = 100;

/** "Fold: 5 points more than the solver", "Call: matches the solver" when the shares round to the same point. */
export function gapSentence(label: string, yours: number, solver: number): string {
  const points = Math.round((yours - solver) * POINTS_PER_SHARE);
  if (points === 0) return `${label}: matches the solver`;
  const size = Math.abs(points);
  return `${label}: ${size} ${size === 1 ? "point" : "points"} ${points > 0 ? "more" : "less"} than the solver`;
}

/** "12 of 30 decisions at this spot". */
export function sampleText(decisions: number, minimum: number): string {
  return `${decisions} of ${minimum} decisions at this spot`;
}
