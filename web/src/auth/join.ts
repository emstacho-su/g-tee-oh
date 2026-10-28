/**
 * The join calls (S42, R3.13, O-349): POST /auth/invites/inspect and POST /auth/join, both public,
 * and useJoin, which, like useLogin, keeps the returned CSRF (cross-site request forgery) token in
 * memory and seeds the me query so home needs no extra /me. The token is only ever a request body
 * field: it is never put in a URL, a query key or storage.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { InvitePreview, SessionInfo } from "../contracts.js";
import { useAppApi } from "./api-context.js";
import { ME_QUERY_KEY } from "./session.js";

export interface JoinInput {
  token: string;
  displayName: string;
  password: string;
}

export async function inspectInvite(api: AppApi, token: string): Promise<InvitePreview> {
  const { data, error, response } = await api.client.POST("/api/v1/auth/invites/inspect", { body: { token } });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export async function join(api: AppApi, input: JoinInput): Promise<SessionInfo> {
  const { data, error, response } = await api.client.POST("/api/v1/auth/join", {
    body: { token: input.token, display_name: input.displayName, password: input.password },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export function useJoin() {
  const api = useAppApi();
  const queryClient = useQueryClient();
  return useMutation<SessionInfo, Error, JoinInput>({
    mutationFn: (input) => join(api, input),
    onSuccess: (session) => {
      api.tokens.set(session.csrf_token);
      queryClient.setQueryData(ME_QUERY_KEY, session);
    },
  });
}
