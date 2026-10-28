/**
 * Every game configuration (S32, R4.12, O-323): the list the Session defaults section offers as
 * a configuration scope. GET /configs is paged, so the read follows next_cursor up to
 * MAX_CONFIG_PAGES pages of CONFIG_PAGE_LIMIT and fails loudly past that rather than show a
 * silently cut list. A response without data becomes an ApiProblem through problemFromBody.
 */
import { queryOptions } from "@tanstack/react-query";

import { problemFromBody } from "../../api/index.js";
import type { AppApi } from "../../api/index.js";
import type { GameConfig } from "../../progress/types.js";

/** The api's largest page. */
export const CONFIG_PAGE_LIMIT = 200;
export const MAX_CONFIG_PAGES = 10;
/** The catalog changes only when the owner adds configurations; half an hour is fresh enough. */
export const CONFIGS_STALE_MS = 30 * 60 * 1000;

export async function fetchAllConfigs(api: AppApi): Promise<GameConfig[]> {
  const configs: GameConfig[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CONFIG_PAGES; page += 1) {
    const query = cursor === undefined ? { limit: CONFIG_PAGE_LIMIT } : { limit: CONFIG_PAGE_LIMIT, cursor };
    const { data, error, response } = await api.client.GET("/api/v1/configs", { params: { query } });
    if (data === undefined) throw problemFromBody(response.status, error);
    configs.push(...data.items);
    if (data.next_cursor === null) return configs;
    cursor = data.next_cursor;
  }
  throw new RangeError(`the configuration list did not end within ${MAX_CONFIG_PAGES} pages`);
}

export function allConfigsQuery(api: AppApi) {
  return queryOptions({
    queryKey: ["catalog", "configs-all"] as const,
    queryFn: () => fetchAllConfigs(api),
    staleTime: CONFIGS_STALE_MS,
    retry: false,
  });
}

const CBB_PER_BB = 100;
const FORMAT_NAMES: Readonly<Record<GameConfig["format"], string>> = { online: "Online", live: "Live" };

/** "Online, 6 players, 100 bb deep, stakes online", from the api's fields only. */
export function configLabel(config: GameConfig): string {
  const parts = [
    FORMAT_NAMES[config.format],
    `${config.table_size} players`,
    `${config.depth_cbb / CBB_PER_BB} bb deep`,
    `stakes ${config.stake_label}`,
  ];
  return config.straddle ? [...parts, "straddle"].join(", ") : parts.join(", ");
}
