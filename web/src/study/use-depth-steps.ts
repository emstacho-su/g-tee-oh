/**
 * The covered depths around the address's depth, for the ] and [ Study keys (S45, R3.12,
 * O-467). Reads the pairs of every sibling configuration (the same format, table size and stake)
 * through pairsQuery, the query the settings panel already uses, so most reads are cache hits and the
 * rest are small catalog reads; depth-steps.ts does the rest, purely.
 *
 * The neighbours are computed on every render from the reads' current data (code review): there are
 * two to four sibling configurations, so the work is a few short list scans, and no memo key can go
 * stale when a refetch flips a pair's availability. Only the sibling list is memoised, since it
 * decides which queries run.
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AppApi } from "../api/index.js";
import { coveredDepths, depthNeighbours, siblingConfigIds, type DepthNeighbours } from "./depth-steps.js";
import { pairsQuery, type GameConfig, type PositionPairEntry } from "./queries.js";
import type { StudySearch } from "./search.js";

const NO_NEIGHBOURS: DepthNeighbours = { deeper: undefined, shallower: undefined };

export function useDepthSteps(api: AppApi, configs: readonly GameConfig[] | undefined, search: StudySearch): DepthNeighbours {
  const siblings = useMemo(() => (configs === undefined ? [] : siblingConfigIds(configs, search)), [configs, search]);
  const reads = useQueries({ queries: siblings.map(({ configId }) => pairsQuery(api, configId)) });
  if (configs === undefined) return NO_NEIGHBOURS;
  const byConfig = new Map<string, readonly PositionPairEntry[] | undefined>(siblings.map(({ configId }, index) => [configId, reads[index]?.data]));
  return depthNeighbours(coveredDepths(configs, search, (configId) => byConfig.get(configId)), search.depth);
}
