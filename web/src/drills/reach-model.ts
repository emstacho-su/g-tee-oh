/**
 * What a drill reaches and how much of it the library covers (S47, R3.37, O-482, O-485, design
 * rule 8: a drill is a saved query over the finite catalog, shown with its count).
 *
 * Mechanism: the api's candidate rule (services/api/src/sessions/candidates.ts) restated over the
 * two catalog reads the web already holds, GET /configs and GET /configs/{id}/pairs, and held to it
 * by the shared cases of validation/fixtures/drills/candidate-rule-cases.json, which both sides
 * run. A configuration is reached when its format, table size and stake label are the drill's, its
 * depth is one of the drill's depths and it has no ante; a pair is reached when one seat is a hero
 * and the other a villain (every other seat when the drill names none). A reached pair is covered
 * when the pairs read marks it preflop_available. The pair is matched by its unordered seat set
 * (pairKeyOf), so the web applies no ordering rule of its own (ADR 0004); counts are set
 * arithmetic, never a poker number. "Queued" is not claimed: only a start knows the queue, so the
 * third figure is what is not built yet (O-485). Pure; every function returns new values.
 */
import type { PositionPairEntry } from "../practice/catalog-spot.js";
import type { GameConfig } from "../progress/types.js";
import { seatedPositions } from "./limits.js";
import type { Position, SpotFilter } from "./types.js";

export type ReachFilter = Pick<SpotFilter, "game_config" | "stake" | "hero_positions" | "villain_positions">;

export interface Reach {
  /** The (configuration, pair) spots the drill reaches. */
  readonly spots: number;
  readonly covered: number;
  readonly missing: number;
  readonly configIds: readonly string[];
}

export type CoverageBadgeKind = "covered" | "partly" | "none" | "no-config";

export interface CoverageBadge {
  readonly kind: CoverageBadgeKind;
  readonly text: string;
}

const CBB_PER_BB = 100;
const NO_ANTE_CBB = 0;
const KEY_SEPARATOR = "-";

export const REACH_TEXT = {
  noConfig: "Names no configuration in the catalog.",
  counting: "Counting the spots this drill reaches.",
} as const;

export const BADGE_TEXT = {
  covered: "Covered",
  none: "Not built yet",
  noConfig: "Not in the catalog",
  partly: (missing: number) => `Partly covered: ${missing} not built`,
} as const;

/** The configurations a drill reaches, in catalog order (the api's configIdsFor rule). */
export function configsReached(filter: ReachFilter, configs: readonly GameConfig[]): GameConfig[] {
  const { format, table_size: tableSize, depths_bb: depths } = filter.game_config;
  const depthsCbb = new Set(depths.map((depth) => depth * CBB_PER_BB));
  return configs.filter(
    (config) =>
      config.format === format &&
      config.table_size === tableSize &&
      config.stake_label === filter.stake &&
      depthsCbb.has(config.depth_cbb) &&
      config.ante_cbb === NO_ANTE_CBB,
  );
}

/** The seat set of a pair as one key, the same whichever seat comes first. */
export function pairKeyOf(first: string, second: string): string {
  return [first, second].sort().join(KEY_SEPARATOR);
}

/** The pair keys a drill reaches at a table size (the api's pairsAt rule), sorted, without repeats. */
export function pairKeys(tableSize: number, heroes: readonly Position[], villains: readonly Position[]): string[] {
  const seated = seatedPositions(tableSize);
  const keys = heroes.flatMap((hero) => {
    const others = villains.length > 0 ? villains : seated.filter((seat) => seat !== hero);
    return others.filter((villain) => villain !== hero).map((villain) => pairKeyOf(hero, villain));
  });
  return [...new Set(keys)].sort();
}

function coveredKeys(pairs: readonly PositionPairEntry[]): Set<string> {
  return new Set(pairs.filter((pair) => pair.preflop_available).map((pair) => pairKeyOf(pair.oop, pair.ip)));
}

/**
 * The drill's reach over the catalog, or undefined while a reached configuration's pairs have not
 * loaded. No reached configuration is a reach of zero spots.
 */
export function reachOf(
  filter: ReachFilter,
  configs: readonly GameConfig[],
  pairsByConfig: Readonly<Record<string, readonly PositionPairEntry[] | undefined>>,
): Reach | undefined {
  const reached = configsReached(filter, configs);
  const keys = pairKeys(filter.game_config.table_size, filter.hero_positions, filter.villain_positions);
  const configIds = reached.map((config) => config.config_id);
  const loaded = configIds.map((id) => pairsByConfig[id]);
  if (loaded.some((pairs) => pairs === undefined)) return undefined;
  const covered = loaded.reduce((total, pairs) => {
    const available = coveredKeys(pairs ?? []);
    return total + keys.filter((key) => available.has(key)).length;
  }, 0);
  const spots = configIds.length * keys.length;
  return { spots, covered, missing: spots - covered, configIds };
}

function spotsWord(count: number): string {
  return count === 1 ? "spot" : "spots";
}

/** "Reaches N spots; K covered, M not built yet." */
export function reachText(reach: Reach): string {
  if (reach.configIds.length === 0) return REACH_TEXT.noConfig;
  return `Reaches ${reach.spots} ${spotsWord(reach.spots)}; ${reach.covered} covered, ${reach.missing} not built yet.`;
}

/** The row badge (O-482): Covered, Partly covered: M not built, Not built yet, or Not in the catalog. */
export function badgeOf(reach: Reach): CoverageBadge {
  if (reach.configIds.length === 0) return { kind: "no-config", text: BADGE_TEXT.noConfig };
  if (reach.covered === 0) return { kind: "none", text: BADGE_TEXT.none };
  if (reach.covered < reach.spots) return { kind: "partly", text: BADGE_TEXT.partly(reach.missing) };
  return { kind: "covered", text: BADGE_TEXT.covered };
}
