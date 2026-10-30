/**
 * The reach of a drill over the catalog, as a hook (S47, R3.37, O-482, O-485): the status line of
 * the builder and the coverage badge of each library row read it. It joins the configuration list
 * (settings' allConfigsQuery) with the pairs of every reached configuration (practicePairsQuery,
 * one read per configuration, cached by react-query so fifty rows share them) and hands the pure
 * reach model (reach-model.ts) the result.
 *
 * States: undefined while a read is on its way, { reach } once every reached configuration's pairs
 * are known (a reach of zero configurations needs no pairs), or { failed: true } when a read failed
 * (the badge then says nothing rather than something wrong).
 */
import { useQueries, useQuery } from "@tanstack/react-query";

import { useAppApi } from "../auth/index.js";
import { practicePairsQuery, type PositionPairEntry } from "../practice/catalog-spot.js";
import { allConfigsQuery } from "../routes/settings/configs-query.js";
import { configsReached, reachOf, type Reach, type ReachFilter } from "./reach-model.js";

export type DrillReach = { readonly reach: Reach; readonly failed?: false } | { readonly reach?: undefined; readonly failed: true } | undefined;

export function useDrillReach(filter: ReachFilter): DrillReach {
  const api = useAppApi();
  const configs = useQuery(allConfigsQuery(api));
  const reached = configs.data === undefined ? [] : configsReached(filter, configs.data);
  const pairReads = useQueries({ queries: reached.map((config) => practicePairsQuery(api, config.config_id)) });
  if (configs.isError || pairReads.some((read) => read.isError)) return { failed: true };
  if (configs.data === undefined) return undefined;
  const pairsByConfig: Record<string, readonly PositionPairEntry[] | undefined> = Object.fromEntries(
    reached.map((config, index) => [config.config_id, pairReads[index]?.data]),
  );
  const reach = reachOf(filter, configs.data, pairsByConfig);
  return reach === undefined ? undefined : { reach };
}
