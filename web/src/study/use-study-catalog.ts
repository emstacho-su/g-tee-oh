/**
 * The catalog reads behind the study filters (S25, R3.12, O-286).
 *
 * Mechanism: nothing is read until the URL names a format. Then the stakes and the format's
 * configurations load side by side (stakesQuery, formatConfigsQuery); the config_id resolves from
 * the configurations and the URL's table size, stake and depth (filters.ts); the pairs load once a
 * config_id is known (pairsQuery). The hook reports the first failed read as one failure with a
 * retry that refetches only the failed reads, so a failed catalog call shows an error state with
 * no uncaught error. The selected pair counts as studyable only when the pairs list holds it
 * with preflop_available, which is the guard that keeps the screen from reading a node before
 * the config and pair are known.
 */
import { useQuery } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import { resolveConfigId } from "./filters.js";
import { formatConfigsQuery, pairsQuery, stakesQuery, type GameConfig, type PositionPairEntry, type Stake } from "./queries.js";
import type { StudySearch } from "./search.js";

export interface StudyCatalog {
  readonly stakes: readonly Stake[] | undefined;
  readonly configs: readonly GameConfig[] | undefined;
  readonly pairs: readonly PositionPairEntry[] | undefined;
  readonly configId: string | undefined;
  /** The URL's pair when the library covers it at this configuration. */
  readonly studyPair: string | undefined;
  /** The URL's pair when the pairs list marks it not preflop_available. */
  readonly uncoveredPair: string | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly retry: () => void;
}

const UNUSED_FORMAT = "online";
const UNUSED_CONFIG_ID = "";

export function useStudyCatalog(api: AppApi, search: StudySearch): StudyCatalog {
  const format = search.format;
  const stakes = useQuery({ ...stakesQuery(api), enabled: format !== undefined });
  const configs = useQuery({ ...formatConfigsQuery(api, format ?? UNUSED_FORMAT), enabled: format !== undefined });
  const configId = configs.data === undefined ? undefined : resolveConfigId(configs.data, search);
  const pairs = useQuery({ ...pairsQuery(api, configId ?? UNUSED_CONFIG_ID), enabled: configId !== undefined });

  const reads = [stakes, configs, pairs];
  const failed = reads.filter((read) => read.isError);
  const entry = pairs.data?.find((candidate) => candidate.pair === search.pair);
  return {
    stakes: stakes.data,
    configs: configs.data,
    pairs: pairs.data,
    configId,
    studyPair: entry?.preflop_available === true ? entry.pair : undefined,
    uncoveredPair: entry?.preflop_available === false ? entry.pair : undefined,
    loading: reads.some((read) => read.isFetching),
    error: failed[0]?.error ?? null,
    retry: () => {
      for (const read of failed) void read.refetch();
    },
  };
}
