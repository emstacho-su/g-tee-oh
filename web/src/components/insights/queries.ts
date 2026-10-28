/**
 * Query options for the insight cards (S27 lane C, R3.18, O-304), modelled on study/queries.ts:
 * one factory per read, so the key is stable wherever the read happens. GET /insights/drift
 * answers range drift for one node family (the decision's spot_class_key); a response without
 * data becomes an ApiProblem through problemFromBody, so the card sees the status and slug and
 * never raw server detail. Drift changes with every decision in the family, so the key also names
 * the decision's attempt: the next decision is a new key and reads again, while remounting the same
 * decision's panel within DRIFT_STALE_MS reuses the answer (PR #29 review M9; the api also caches
 * the bootstrap per user, spot class and newest attempt).
 */
import { queryOptions } from "@tanstack/react-query";

import { problemFromBody } from "../../api/index.js";
import type { AppApi } from "../../api/index.js";

export const INSIGHTS_QUERY_ROOT = "insights";
/** How long one decision's drift answer is reused, in milliseconds (5 minutes, PR #29 review M9). */
export const DRIFT_STALE_MS = 5 * 60 * 1000;

/** Drift for one node family as of one decision (its attempt id). */
export function driftQueryKey(spotClassKey: string, attemptId: string) {
  return [INSIGHTS_QUERY_ROOT, "drift", spotClassKey, attemptId] as const;
}

export function driftQuery(api: AppApi, spotClassKey: string, attemptId: string) {
  return queryOptions({
    queryKey: driftQueryKey(spotClassKey, attemptId),
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/insights/drift", {
        params: { query: { spot_class_key: spotClassKey } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: DRIFT_STALE_MS,
    retry: false,
  });
}
