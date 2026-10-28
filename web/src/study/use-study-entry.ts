/**
 * The catalog reads behind the study entry (S39, R3.12, O-354, O-392).
 *
 * Mechanism: the settings panel shows every choice at once, so the stakes and the configurations
 * of both formats load as soon as the page opens (stakesQuery, formatConfigsQuery). Two pairs
 * reads follow: the pairs of the URL's configuration, which decide whether the URL names a
 * covered spot (only then does the page read a node, ADR 0018), and the pairs of the draft's
 * configuration, which the panel's seat choices need. When both name the same configuration they
 * are one query. The first failed read is reported as one failure whose retry refetches only the
 * failed reads, as useStudyCatalog does for /library.
 */
import { useQuery } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import { resolveConfigId } from "./filters.js";
import { formatConfigsQuery, pairsQuery, stakesQuery, type GameConfig, type PositionPairEntry, type Stake } from "./queries.js";
import type { StudySearch } from "./search.js";
import type { SettingsCatalog, SettingsDraft } from "./settings.js";

export interface StudyEntry {
  /** Undefined until the stakes and both formats' configurations have loaded. */
  readonly catalog: SettingsCatalog | undefined;
  readonly stakes: readonly Stake[] | undefined;
  /** The URL's configuration, when its four settings name one. */
  readonly configId: string | undefined;
  /** The URL's pair when the library covers it at the URL's configuration. */
  readonly studyPair: PositionPairEntry | undefined;
  /** The URL's pair when the pairs list marks it not preflop_available. */
  readonly uncoveredPair: string | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly retry: () => void;
}

const UNUSED_CONFIG_ID = "";

function usePairs(api: AppApi, configId: string | undefined) {
  return useQuery({ ...pairsQuery(api, configId ?? UNUSED_CONFIG_ID), enabled: configId !== undefined });
}

export function useStudyEntry(api: AppApi, search: StudySearch, draft: SettingsDraft): StudyEntry {
  const stakes = useQuery(stakesQuery(api));
  const online = useQuery(formatConfigsQuery(api, "online"));
  const live = useQuery(formatConfigsQuery(api, "live"));
  const configs: readonly GameConfig[] | undefined =
    online.data === undefined || live.data === undefined ? undefined : [...online.data, ...live.data];

  const configId = configs === undefined ? undefined : resolveConfigId(configs, search);
  const draftConfigId = configs === undefined ? undefined : resolveConfigId(configs, draft);
  const urlPairs = usePairs(api, configId);
  const draftPairs = usePairs(api, draftConfigId);

  const reads = [stakes, online, live, urlPairs, draftPairs];
  const failed = reads.filter((read) => read.isError);
  const entry = urlPairs.data?.find((candidate) => candidate.pair === search.pair);
  const pairsOf = (id: string): readonly PositionPairEntry[] | undefined => {
    if (id === configId) return urlPairs.data;
    return id === draftConfigId ? draftPairs.data : undefined;
  };
  return {
    catalog: stakes.data === undefined || configs === undefined ? undefined : { stakes: stakes.data, configs, pairsOf },
    stakes: stakes.data,
    configId,
    studyPair: entry?.preflop_available === true ? entry : undefined,
    uncoveredPair: entry?.preflop_available === false ? entry.pair : undefined,
    loading: reads.some((read) => read.isFetching),
    error: failed[0]?.error ?? null,
    retry: () => {
      for (const read of failed) void read.refetch();
    },
  };
}
