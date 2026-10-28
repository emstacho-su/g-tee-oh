/**
 * The table a practice picker is set to (S41, R3.16, R3.17, O-33, O-415), shared by the quiz start
 * screen and the painting spot picker.
 *
 * Mechanism: reads every configuration (settings' allConfigsQuery, so the cache is shared with the
 * Session defaults section) and keeps the served ones (no ante, O-33). The chosen configuration is
 * the caller's wish when the list holds it (an address or the last quiz), else the session
 * defaults' first configuration when their scope is a list, else the first served one. The chosen
 * table's pairs (GET /configs/{id}/pairs) give the covered seats: a seat is covered when any pair
 * with preflop_available holds it (catalog-spot.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAppApi } from "../auth/index.js";
import type { Position } from "../contracts.js";
import { seatedPositions } from "../drills/limits.js";
import type { GameConfig } from "../progress/types.js";
import { allConfigsQuery } from "../routes/settings/configs-query.js";
import { useSessionDefaultsStore } from "../store/session-defaults.js";
import { coveredSeats, defaultConfigId, practicePairsQuery, servedConfigs, type PositionPairEntry } from "./catalog-spot.js";

export interface CatalogTable {
  /** The served configurations; undefined while the list loads. */
  configs: readonly GameConfig[] | undefined;
  configsError: unknown;
  configId: string | null;
  setConfigId: (configId: string) => void;
  /** The seats at the chosen table, in seat order. */
  seated: readonly Position[];
  pairs: readonly PositionPairEntry[] | undefined;
  /** The seated positions with a covered pair; empty while the pairs load. */
  covered: readonly Position[];
  pairsError: unknown;
}

export function useCatalogTable(wanted: string | undefined): CatalogTable {
  const api = useAppApi();
  const scope = useSessionDefaultsStore((state) => state.defaults.configScope);
  const configsQuery = useQuery(allConfigsQuery(api));
  const configs = configsQuery.data === undefined ? undefined : servedConfigs(configsQuery.data);
  const [picked, setPicked] = useState<string | null>(null);
  const fallback = configs === undefined ? null : defaultConfigId(configs, scope);
  const candidate = picked ?? wanted ?? null;
  const configId = configs?.some((config) => config.config_id === candidate) === true ? candidate : fallback;
  const config = configs?.find((entry) => entry.config_id === configId);
  const pairsQuery = useQuery({ ...practicePairsQuery(api, configId ?? ""), enabled: configId !== null });
  const seated = config === undefined ? [] : seatedPositions(config.table_size);
  return {
    configs,
    configsError: configsQuery.error,
    configId,
    setConfigId: setPicked,
    seated,
    pairs: pairsQuery.data,
    covered: pairsQuery.data === undefined ? [] : coveredSeats(pairsQuery.data, seated),
    pairsError: pairsQuery.error,
  };
}
