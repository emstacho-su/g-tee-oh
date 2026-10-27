/**
 * The app's TanStack Query client (R3.13, A7 section 1). A 4xx ApiProblem is an answer, not a
 * transient failure, so it is never retried; network errors and 5xx answers retry a bounded
 * number of times. Mutations never retry (a repeated POST is the caller's decision). A 401 from
 * any query or mutation means the session is gone, so it sets the me query to null (signed out),
 * which the authenticated layout turns into a trip to /login.
 */
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { HTTP_STATUS } from "../api/http-status.js";
import { isApiProblem } from "../api/index.js";
import { ME_QUERY_KEY } from "./session.js";

const MAX_QUERY_RETRIES = 2;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_CLIENT_ERROR_MAX = 499;


function isClientError(error: unknown): boolean {
  return isApiProblem(error) && error.status >= HTTP_CLIENT_ERROR_MIN && error.status <= HTTP_CLIENT_ERROR_MAX;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  return failureCount < MAX_QUERY_RETRIES;
}

export function createQueryClient(): QueryClient {
  const markSignedOut = (error: unknown): void => {
    if (isApiProblem(error) && error.status === HTTP_STATUS.unauthorized) {
      queryClient.setQueryData(ME_QUERY_KEY, null);
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: markSignedOut }),
    mutationCache: new MutationCache({ onError: markSignedOut }),
    defaultOptions: {
      queries: { retry: shouldRetryQuery },
      mutations: { retry: false },
    },
  });
  return queryClient;
}
