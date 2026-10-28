/**
 * The admin's builder controls (S28, R3.5, O-36, O-241, O-290, O-295).
 *
 * Mechanism: the builder status is read only when the session is an admin (SessionInfo.user
 * .is_admin); a member never asks, and the api would answer 403 anyway. Pause and resume each send
 * one POST with a fresh Idempotency-Key; the answer is the status after the change and replaces
 * the cached one, so the state on screen is the stored paused setting at once. The api does not
 * announce a pause of its own (O-295): a builder_state event arrives only from the builder, and
 * applyBuilderState folds it into the cache as a new object. A settings save sends only the
 * changed keys and the answer's stored settings replace the cached ones; a failure is returned to
 * the form, which shows a fixed message.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import { useMe } from "../auth/index.js";
import type { BuilderStatus } from "../contracts.js";
import type { BuilderStateEvent } from "./events.js";
import { useLibraryDeps } from "./library-deps.js";
import {
  BUILDER_STATUS_KEY,
  builderStatusQuery,
  patchBuilderSettings,
  setBuilderPaused,
  withSettings,
  type BuilderSettingsPatch,
  type StoredBuilderSettings,
} from "./queries.js";

/** True when the signed-in user is an admin (O-290). */
export function useIsAdmin(): boolean {
  return useMe().data?.user.is_admin === true;
}

export function useBuilderStatus(api: AppApi, isAdmin: boolean) {
  return useQuery({ ...builderStatusQuery(api), enabled: isAdmin });
}

export interface PauseControl {
  setPaused: (paused: boolean) => void;
  pending: boolean;
  error: unknown;
}

export function usePauseControl(api: AppApi): PauseControl {
  const queryClient = useQueryClient();
  const { newKey } = useLibraryDeps();
  const mutation = useMutation<BuilderStatus, Error, boolean>({
    mutationFn: (paused) => setBuilderPaused(api, paused, newKey()),
    onSuccess: (status) => {
      queryClient.setQueryData(BUILDER_STATUS_KEY, status);
    },
  });
  return { setPaused: (paused) => mutation.mutate(paused), pending: mutation.isPending, error: mutation.error };
}

export type SaveSettings = (patch: BuilderSettingsPatch) => Promise<StoredBuilderSettings>;

export function useSaveSettings(api: AppApi): SaveSettings {
  const queryClient = useQueryClient();
  const { newKey } = useLibraryDeps();
  const mutation = useMutation<StoredBuilderSettings, Error, BuilderSettingsPatch>({
    mutationFn: (patch) => patchBuilderSettings(api, patch, newKey()),
    onSuccess: (settings) => {
      queryClient.setQueryData<BuilderStatus>(BUILDER_STATUS_KEY, (status) =>
        status === undefined ? status : withSettings(status, settings),
      );
    },
  });
  return mutation.mutateAsync;
}

/**
 * The cached status after a builder_state event. The stored paused setting wins, as it does in
 * GET /admin/builder: while it is on, the state shown stays paused.
 */
export function applyBuilderState(status: BuilderStatus, event: BuilderStateEvent): BuilderStatus {
  if (status.settings["paused"] === true) return status;
  return { ...status, state: event.state, reason: event.reason };
}
