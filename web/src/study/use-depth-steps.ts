/**
 * The covered depths around the address's depth, for the ] and [ Study keys (S45, R3.12,
 * O-467). Reads the pairs of every sibling configuration (the same format, table size and stake)
 * through pairsQuery, the query the settings panel already uses, so most reads are cache hits and the
 * rest are small catalog reads; depth-steps.ts does the rest, purely.
 *
 * The neighbours are computed on every render from the reads' current data (code review): there are
 * two to four sibling configurations, so the work is a few short list scans, and no memo key can go
 * stale when a refetch flips a pair's availability. Only the sibling list is memoised, since it
 * decides which queries run. A sibling whose read failed is never dropped silently (code review 3):
 * each failure is logged once, keyed on its configuration and the time it failed, so a later
 * failure of the same read logs again (PR 52 review 1), with no URL or search content. A failed
 * depth is listed as unchecked, which the screen says in words, only when it is not the address's
 * own depth and its read holds no seats; a failed refetch that kept its cached seats was checked.
 */
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { describeFailureForLog } from "../api/http-status.js";
import type { AppApi } from "../api/index.js";
import { coveredDepths, depthNeighbours, siblingConfigIds, type DepthNeighbours } from "./depth-steps.js";
import { pairsQuery, type GameConfig, type PositionPairEntry } from "./queries.js";
import { validateStudySearch, type StudySearch } from "./search.js";

export interface DepthSteps extends DepthNeighbours {
  /** Sibling depths whose seats could not be read, so the keys could not check them. */
  readonly unchecked: readonly number[];
}

const NO_STEPS: DepthSteps = { deeper: undefined, shallower: undefined, unchecked: [] };

export function useDepthSteps(api: AppApi, configs: readonly GameConfig[] | undefined, search: StudySearch): DepthSteps {
  // Keyed on the settings the siblings depend on, never on the search object, a new one each render (code review 2).
  const { format, table_size: tableSize, stake, depth } = search;
  const siblings = useMemo(
    () => (configs === undefined ? [] : siblingConfigIds(configs, validateStudySearch({ format, table_size: tableSize, stake, depth }))),
    [configs, format, tableSize, stake, depth],
  );
  const reads = useQueries({ queries: siblings.map(({ configId }) => pairsQuery(api, configId)) });
  const failed = siblings.flatMap((sibling, index) => {
    const read = reads[index];
    if (read?.isError !== true) return [];
    return [{ ...sibling, error: read.error, logKey: `${sibling.configId}@${read.errorUpdatedAt}`, hasSeats: read.data !== undefined }];
  });
  const failedKey = failed.map((entry) => entry.logKey).join("|");
  const logged = useRef(new Set<string>());

  useEffect(() => {
    for (const entry of failed.filter(({ logKey }) => !logged.current.has(logKey))) {
      logged.current.add(entry.logKey);
      console.error(`g-tee-oh: the seats of ${entry.configId} could not be read for the depth keys (${describeFailureForLog(entry.error)})`);
    }
    // failedKey stands for the failed list, a new array each render: each distinct failure logs once.
  }, [failedKey]);

  if (configs === undefined) return NO_STEPS;
  const byConfig = new Map<string, readonly PositionPairEntry[] | undefined>(siblings.map(({ configId }, index) => [configId, reads[index]?.data]));
  const neighbours = depthNeighbours(coveredDepths(configs, search, (configId) => byConfig.get(configId)), search.depth);
  const unchecked = failed.filter((entry) => entry.depth !== search.depth && !entry.hasSeats).map((entry) => entry.depth);
  return { ...neighbours, unchecked };
}
