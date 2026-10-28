/**
 * The admin's builder controls (S28, R3.5, O-36, O-241, O-290, O-295, O-232).
 *
 * Mechanism: the builder status is read only when the session is an admin (SessionInfo.user
 * .is_admin); a member never asks, and the api would answer 403 anyway. Pause, resume and a
 * settings save each go through an intent mutation (use-intent-mutation.ts): one write and one
 * Idempotency-Key per user intent, so a double click sends one request. A pause or resume answer
 * is the status after the change and replaces the cached one. The api does not announce a pause
 * of its own (O-295): a builder_state event arrives only from the builder, and applyBuilderState
 * folds it into the cache as a new object. A settings save sends only the changed keys and the
 * answer's stored settings replace the cached ones.
 *
 * A 403 forbidden from any admin call means the flag was revoked after /me was read, so the me
 * query is invalidated: the refetched session hides the controls (PR #28 security review).
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { HTTP_STATUS, isApiProblem, PROBLEM_SLUG } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import { ME_QUERY_KEY, useMe } from "../auth/index.js";
import type { BuilderStatus } from "../contracts.js";
import type { BuilderStateEvent } from "./events.js";
import {
  BUILDER_STATUS_KEY,
  builderStatusQuery,
  patchBuilderSettings,
  setBuilderPaused,
  withSettings,
  type BuilderSettingsPatch,
  type StoredBuilderSettings,
} from "./queries.js";
import { useIntentMutation } from "./use-intent-mutation.js";

/** True when the signed-in user is an admin (O-290). */
export function useIsAdmin(): boolean {
  return useMe().data?.user.is_admin === true;
}

/** True for the api's 403 forbidden problem (not a 403 csrf, which the client retries itself). */
export function isForbidden(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.forbidden && error.slug === PROBLEM_SLUG.forbidden;
}

/** Rechecks the session after an admin call was refused. */
function recheckOnForbidden(queryClient: QueryClient, error: unknown): void {
  if (isForbidden(error)) void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
}

function useRecheckOnForbidden(): (error: unknown) => void {
  const queryClient = useQueryClient();
  return (error) => recheckOnForbidden(queryClient, error);
}

export function useBuilderStatus(api: AppApi, isAdmin: boolean) {
  const status = useQuery({ ...builderStatusQuery(api), enabled: isAdmin });
  const queryClient = useQueryClient();
  const { error } = status;
  useEffect(() => {
    recheckOnForbidden(queryClient, error);
  }, [queryClient, error]);
  return status;
}

export interface PauseControl {
  setPaused: (paused: boolean) => void;
  pending: boolean;
  error: unknown;
}

export function usePauseControl(api: AppApi): PauseControl {
  const queryClient = useQueryClient();
  const recheck = useRecheckOnForbidden();
  const mutation = useIntentMutation<boolean, BuilderStatus>({
    run: (paused, key) => setBuilderPaused(api, paused, key),
    onSuccess: (status) => {
      queryClient.setQueryData(BUILDER_STATUS_KEY, status);
    },
    onError: recheck,
  });
  return { setPaused: mutation.send, pending: mutation.busy, error: mutation.error };
}

export type SaveSettings = (patch: BuilderSettingsPatch) => Promise<StoredBuilderSettings>;

export function useSaveSettings(api: AppApi): SaveSettings {
  const queryClient = useQueryClient();
  const recheck = useRecheckOnForbidden();
  const mutation = useIntentMutation<BuilderSettingsPatch, StoredBuilderSettings>({
    run: (patch, key) => patchBuilderSettings(api, patch, key),
    onSuccess: (settings) => {
      queryClient.setQueryData<BuilderStatus>(BUILDER_STATUS_KEY, (status) =>
        status === undefined ? status : withSettings(status, settings),
      );
    },
    onError: recheck,
  });
  return mutation.start;
}

/**
 * The cached status after a builder_state event. The stored paused setting wins, as it does in
 * GET /admin/builder: while it is on, the state shown stays paused.
 */
export function applyBuilderState(status: BuilderStatus, event: BuilderStateEvent): BuilderStatus {
  if (status.settings["paused"] === true) return status;
  return { ...status, state: event.state, reason: event.reason };
}
