/**
 * The frequency read behind the /progress card (S41, R4.12, O-353, O-418): GET
 * /progress/frequencies, which takes no parameter (the api scopes it to the signed-in user).
 *
 * Mechanism: one typed client call; a response without data becomes an ApiProblem through
 * problemFromBody, so the card never sees the body or its detail. The key sits under the progress
 * root, so ending a session refreshes it with the other progress reads (invalidateProgress, O-326),
 * and it shares their half-minute fresh time.
 */
import { queryOptions } from "@tanstack/react-query";

import { problemFromBody, type AppApi } from "../api/index.js";
import type { FrequencyComparison } from "./frequency-model.js";
import { PROGRESS_QUERY_ROOT, PROGRESS_STALE_MS } from "./queries.js";

export function frequencyQuery(api: AppApi) {
  return queryOptions({
    queryKey: [PROGRESS_QUERY_ROOT, "frequencies"] as const,
    queryFn: async (): Promise<FrequencyComparison> => {
      const { data, error, response } = await api.client.GET("/api/v1/progress/frequencies");
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: PROGRESS_STALE_MS,
    retry: false,
  });
}
