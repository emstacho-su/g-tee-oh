/**
 * The session query and the login and logout calls (R3.13, O-230). GET /me is the one source of
 * "who is signed in": 200 is the SessionInfo (its csrf_token goes into the in-memory holder),
 * 401 is signed out and resolves to null rather than an error, anything else throws an
 * ApiProblem. The me query does not retry, so a failing api shows its error screen at once with a
 * retry button instead of a long spinner.
 */
import { queryOptions } from "@tanstack/react-query";

import { HTTP_STATUS } from "../api/http-status.js";
import { API_PATHS, problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { SessionInfo } from "../contracts.js";

export const ME_QUERY_KEY = ["auth", "me"] as const;

const ME_STALE_MS = 5 * 60 * 1000;


export interface LoginInput {
  email: string;
  password: string;
}

export async function fetchMe(api: AppApi): Promise<SessionInfo | null> {
  const { data, error, response } = await api.client.GET(API_PATHS.me);
  if (response.status === HTTP_STATUS.unauthorized) {
    api.tokens.clear();
    return null;
  }
  if (data === undefined) throw problemFromBody(response.status, error);
  api.tokens.set(data.csrf_token);
  return data;
}

export function meQueryOptions(api: AppApi) {
  return queryOptions({
    queryKey: ME_QUERY_KEY,
    queryFn: () => fetchMe(api),
    staleTime: ME_STALE_MS,
    retry: false,
  });
}

export async function login(api: AppApi, input: LoginInput): Promise<SessionInfo> {
  const { data, error, response } = await api.client.POST(API_PATHS.login, { body: input });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export async function logout(api: AppApi): Promise<void> {
  const { error, response } = await api.client.POST(API_PATHS.logout);
  if (!response.ok) throw problemFromBody(response.status, error);
}
