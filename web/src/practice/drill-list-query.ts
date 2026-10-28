/**
 * The drill list both practice pickers read (S27, R3.16, R3.17, O-302, PR #29 review L11): GET
 * /drills, first page. /predict and /paint used to read it under two keys with two limits; one
 * factory and one key mean moving between the screens reads the list once and both pickers show
 * the same drills. A response without data becomes an ApiProblem through problemFromBody, so each
 * picker maps the status and slug to its own fixed text and never shows server detail.
 */
import { queryOptions } from "@tanstack/react-query";

import { problemFromBody, type AppApi } from "../api/index.js";
import type { Drill } from "../trainer/session-types.js";

export const PRACTICE_QUERY_ROOT = "practice";
/** Drills a picker lists: the first page (a personal library is small; the api allows up to 200). */
export const DRILL_LIST_LIMIT = 100;
/** The drill list rarely changes while a picker is open (1 minute). */
export const DRILL_LIST_STALE_MS = 60 * 1000;

export function drillListQueryKey() {
  return [PRACTICE_QUERY_ROOT, "drills", DRILL_LIST_LIMIT] as const;
}

export function drillListQuery(api: AppApi) {
  return queryOptions({
    queryKey: drillListQueryKey(),
    queryFn: async (): Promise<Drill[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/drills", { params: { query: { limit: DRILL_LIST_LIMIT } } });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: DRILL_LIST_STALE_MS,
    retry: false,
  });
}
