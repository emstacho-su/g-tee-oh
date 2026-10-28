/**
 * The catalog reads behind the study entry (S39, R3.12, O-354, O-392).
 *
 * Mechanism: the settings panel shows every choice at once, so the stakes and the configurations
 * of both formats load as soon as the page opens (stakesQuery, formatConfigsQuery). Two pairs
 * reads follow (gatedPairsQuery): the pairs of the URL's configuration, which decide whether the
 * URL names a covered spot (only then does the page read a node, ADR 0018), and the pairs of the
 * draft's configuration, which the panel's seat choices need. When both name the same
 * configuration they are one query.
 *
 * Review round 1: the catalog reads (stakes, configurations, the URL's pairs) and the draft's read
 * are reported apart (combineReads), so a draft still loading never hides the panel behind the
 * page's loading note, and a draft read that failed shows inside the panel, never over a confirmed
 * solution. The merged configurations and the catalog object are memoised on the data they hold,
 * so the panel's choices (memoised on catalog and draft) are not recomputed on unrelated renders.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AppApi } from "../api/index.js";
import { resolveConfigId } from "./filters.js";
import { formatConfigsQuery, stakesQuery, type GameConfig, type PositionPairEntry, type Stake } from "./queries.js";
import { combineReads, gatedPairsQuery, type CombinedReads } from "./reads.js";
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
  /** True once the catalog has said whether the URL names a covered spot. */
  readonly urlSettled: boolean;
  /** The stakes, configurations and the URL's pairs. */
  readonly catalogReads: CombinedReads;
  /** The draft configuration's pairs, for the panel. */
  readonly draftReads: CombinedReads;
  /**
   * Whether the read serving the draft configuration's seats failed: the draft's own pairs read,
   * or the URL's when both name one configuration (S39 follow-up).
   */
  readonly draftSeatsFailed: boolean;
}

function useConfigs(api: AppApi) {
  const online = useQuery(formatConfigsQuery(api, "online"));
  const live = useQuery(formatConfigsQuery(api, "live"));
  const configs = useMemo<readonly GameConfig[] | undefined>(
    () => (online.data === undefined || live.data === undefined ? undefined : [...online.data, ...live.data]),
    [online.data, live.data],
  );
  return { configs, reads: [online, live] };
}

export function useStudyEntry(api: AppApi, search: StudySearch, draft: SettingsDraft): StudyEntry {
  const stakes = useQuery(stakesQuery(api));
  const { configs, reads: configReads } = useConfigs(api);
  const configId = configs === undefined ? undefined : resolveConfigId(configs, search);
  const draftConfigId = configs === undefined ? undefined : resolveConfigId(configs, draft);
  const urlPairs = useQuery(gatedPairsQuery(api, configId));
  const draftPairs = useQuery(gatedPairsQuery(api, draftConfigId));

  const catalog = useMemo<SettingsCatalog | undefined>(() => {
    if (stakes.data === undefined || configs === undefined) return undefined;
    const pairsOf = (id: string): readonly PositionPairEntry[] | undefined => {
      if (id === configId) return urlPairs.data;
      return id === draftConfigId ? draftPairs.data : undefined;
    };
    return { stakes: stakes.data, configs, pairsOf };
  }, [stakes.data, configs, configId, draftConfigId, urlPairs.data, draftPairs.data]);

  const entry = urlPairs.data?.find((candidate) => candidate.pair === search.pair);
  return {
    catalog,
    stakes: stakes.data,
    configId,
    studyPair: entry?.preflop_available === true ? entry : undefined,
    urlSettled: catalog !== undefined && (configId === undefined || urlPairs.data !== undefined),
    catalogReads: combineReads([stakes, ...configReads, urlPairs]),
    draftReads: combineReads(draftConfigId === configId ? [] : [draftPairs]),
    draftSeatsFailed: draftConfigId !== undefined && (draftConfigId === configId ? urlPairs.isError : draftPairs.isError),
  };
}
