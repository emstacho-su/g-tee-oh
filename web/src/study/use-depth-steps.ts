/**
 * The covered depths around the address's depth, for the Up and Down Study keys (S45, R3.12,
 * O-467). Reads the pairs of every sibling configuration (the same format, table size and stake)
 * through pairsQuery, the query the settings panel already uses, so most reads are cache hits and the
 * rest are small catalog reads; depth-steps.ts does the rest, purely.
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AppApi } from "../api/index.js";
import { coveredDepths, depthNeighbours, siblingConfigIds, type DepthNeighbours } from "./depth-steps.js";
import { pairsQuery, type GameConfig, type PositionPairEntry } from "./queries.js";
import type { StudySearch } from "./search.js";

export function useDepthSteps(api: AppApi, configs: readonly GameConfig[] | undefined, search: StudySearch): DepthNeighbours {
  const siblings = useMemo(() => (configs === undefined ? [] : siblingConfigIds(configs, search)), [configs, search]);
  const reads = useQueries({ queries: siblings.map(({ configId }) => pairsQuery(api, configId)) });
  const loaded = reads.map((read) => read.data);
  const loadedKey = loaded.map((data) => (data === undefined ? "-" : String(data.length))).join("|");
  return useMemo(() => {
    if (configs === undefined) return { deeper: undefined, shallower: undefined };
    const byConfig = new Map<string, readonly PositionPairEntry[] | undefined>(siblings.map(({ configId }, index) => [configId, loaded[index]]));
    return depthNeighbours(coveredDepths(configs, search, (configId) => byConfig.get(configId)), search.depth);
    // loadedKey stands for the loaded pair lists, which useQueries hands back as a new array each render.
  }, [configs, search, siblings, loadedKey]);
}
