/**
 * The admin invite calls (S42, R3.5, O-349, O-427). The list is a query (it holds no secret); the
 * create call is a plain function, not a mutation, because its answer carries the only copy of the
 * join link and a mutation keeps its result in the QueryClient's mutation cache. The caller holds
 * the link in component state and drops it when its dialog closes. Revoke sends an
 * Idempotency-Key per intent.
 */
import { queryOptions } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER, problemFromBody } from "../../api/index.js";
import type { AppApi } from "../../api/index.js";
import type { CreatedInvite, InviteSummary } from "../../contracts.js";
import { IDEMPOTENCY_HEADER } from "../../trainer/idempotency.js";

export const INVITES_QUERY_KEY = ["admin", "invites"] as const;
/** The newest invites shown; older ones stay in the table as the audit trail. */
export const INVITE_LIST_LIMIT = 50;

export interface InviteList {
  items: readonly InviteSummary[];
  hasMore: boolean;
}

export async function fetchInvites(api: AppApi): Promise<InviteList> {
  const { data, error, response } = await api.client.GET("/api/v1/admin/invites", {
    params: { query: { limit: INVITE_LIST_LIMIT } },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return { items: data.items, hasMore: data.next_cursor !== null };
}

export function invitesQueryOptions(api: AppApi, enabled: boolean) {
  return queryOptions({ queryKey: INVITES_QUERY_KEY, queryFn: () => fetchInvites(api), enabled });
}

export async function createInvite(api: AppApi, email: string): Promise<CreatedInvite> {
  const { data, error, response } = await api.client.POST("/api/v1/admin/invites", {
    params: { header: { ...AUTO_CSRF_HEADER } },
    body: { email },
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

export async function revokeInvite(api: AppApi, id: string, idempotencyKey: string): Promise<InviteSummary> {
  const { data, error, response } = await api.client.POST("/api/v1/admin/invites/{id}/revoke", {
    params: { path: { id }, header: { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: idempotencyKey } },
    body: {},
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}
