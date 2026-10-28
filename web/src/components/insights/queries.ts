/**
 * Query options for the insight cards (S27 lane C, R3.18, O-304), modelled on study/queries.ts:
 * one factory per read, so the key is stable wherever the read happens. GET /insights/drift
 * answers range drift for one node family (the decision's spot_class_key); a response without
 * data becomes an ApiProblem through problemFromBody, so the card sees the status and slug and
 * never raw server detail. Drift changes with every decision in the family, so it is never kept
 * fresh: each feedback panel reads it again.
 */
import { queryOptions } from "@tanstack/react-query";

import { problemFromBody } from "../../api/index.js";
import type { AppApi } from "../../api/index.js";

export const INSIGHTS_QUERY_ROOT = "insights";

export function driftQueryKey(spotClassKey: string) {
  return [INSIGHTS_QUERY_ROOT, "drift", spotClassKey] as const;
}

export function driftQuery(api: AppApi, spotClassKey: string) {
  return queryOptions({
    queryKey: driftQueryKey(spotClassKey),
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/insights/drift", {
        params: { query: { spot_class_key: spotClassKey } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    retry: false,
  });
}
