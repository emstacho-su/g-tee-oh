/**
 * Depth steps at the current line (S45, R3.12, O-467): the ] and [ Study keys move the same
 * spot to the next deeper or shallower depth the library covers, keeping the line, the hand, the
 * lens and the filters, so one spot can be compared at two depths with one key.
 *
 * Mechanism: pure over the catalog the page already read. siblingConfigIds lists the configurations
 * that share the address's format, table size and stake, one per depth (the plain one beats a
 * straddle variant, the resolveConfigId rule), ascending. coveredDepths keeps a depth only when its
 * configuration's pairs have loaded and mark the address's pair preflop_available, so a key never
 * leads to a pair the library lacks (ADR 0018); a depth whose pairs are still loading is skipped
 * until they arrive. A line the deeper tree does not hold reaches the node read's 404 path, which
 * offers LineEscape. No depth is computed: they are the catalog's values.
 */
import { resolveConfigId, withoutNodeChoices } from "./filters.js";
import type { GameConfig, PositionPairEntry } from "./queries.js";
import { validateStudySearch, type StudySearch } from "./search.js";

export interface SiblingConfig {
  readonly depth: number;
  readonly configId: string;
}

export interface DepthNeighbours {
  readonly deeper: number | undefined;
  readonly shallower: number | undefined;
}

/** One configuration per depth at the address's format, table size and stake, ascending by depth. */
export function siblingConfigIds(configs: readonly GameConfig[], search: StudySearch): SiblingConfig[] {
  const { format, table_size: tableSize, stake } = search;
  if (format === undefined || tableSize === undefined || stake === undefined) return [];
  const depths = [
    ...new Set(
      configs
        .filter((config) => config.format === format && config.table_size === tableSize && config.stake_id === stake)
        .map((config) => config.depth_cbb),
    ),
  ].sort((left, right) => left - right);
  return depths.flatMap((depth) => {
    const configId = resolveConfigId(configs, { ...search, depth });
    return configId === undefined ? [] : [{ depth, configId }];
  });
}

/** The sibling depths whose loaded pairs cover the address's pair, ascending. */
export function coveredDepths(
  configs: readonly GameConfig[],
  search: StudySearch,
  pairsOf: (configId: string) => readonly PositionPairEntry[] | undefined,
): number[] {
  const pair = search.pair;
  if (pair === undefined) return [];
  return siblingConfigIds(configs, search)
    .filter(({ configId }) => pairsOf(configId)?.some((entry) => entry.pair === pair && entry.preflop_available) === true)
    .map(({ depth }) => depth);
}

/** The next covered depth above and below the current one; undefined at either end. */
export function depthNeighbours(depths: readonly number[], current: number | undefined): DepthNeighbours {
  if (current === undefined) return { deeper: undefined, shallower: undefined };
  return {
    deeper: depths.find((depth) => depth > current),
    shallower: [...depths].reverse().find((depth) => depth < current),
  };
}

/**
 * The search at another depth: the line, hand and mode kept (O-467); the action filters and the lens
 * dropped, since an action index names another action in another tree (code review).
 */
export function withDepth(search: StudySearch, depth: number): StudySearch {
  return withoutNodeChoices(validateStudySearch({ ...search, depth }));
}
