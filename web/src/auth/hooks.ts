/**
 * Session hooks (R3.13, O-230). useMe reads the me query (null when signed out). useLogin posts
 * the credentials, keeps the returned CSRF (cross-site request forgery) token in memory and seeds
 * the me query so the next route needs no extra /me. useLogout sends the token, then, whether or
 * not the server answered well, forgets the token and the whole query cache, marks the session
 * signed out and goes to /login: a failed logout must never leave the page looking signed in.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { SessionInfo } from "../contracts.js";
import { useAppApi } from "./api-context.js";
import { login, logout, ME_QUERY_KEY, meQueryOptions } from "./session.js";
import type { LoginInput } from "./session.js";

export function useMe() {
  return useQuery(meQueryOptions(useAppApi()));
}

export function useLogin() {
  const api = useAppApi();
  const queryClient = useQueryClient();
  return useMutation<SessionInfo, Error, LoginInput>({
    mutationFn: (input) => login(api, input),
    onSuccess: (session) => {
      api.tokens.set(session.csrf_token);
      queryClient.setQueryData(ME_QUERY_KEY, session);
    },
  });
}

export function useLogout() {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation<void, Error, void>({
    mutationFn: () => logout(api),
    onSettled: async () => {
      api.tokens.clear();
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
      await navigate({ to: "/login" });
    },
  });
}
