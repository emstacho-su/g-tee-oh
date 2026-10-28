/**
 * The coverage and builder reads and writes behind /library and /settings (S28, R3.4, R3.5, A5
 * section 3, ADR 0018, O-240, O-290).
 *
 * Mechanism: each function wraps one typed client call on the generated contract. A response
 * without data becomes an ApiProblem through problemFromBody, so callers branch on the status and
 * slug and never see the body. Every write sends AUTO_CSRF_HEADER (the client substitutes the
 * held token, O-197) and an Idempotency-Key from the caller, so a repeated click replays the first
 * answer instead of writing twice (O-232). Coverage is short-lived (the queue moves), so it is
 * stale after COVERAGE_STALE_MS and refetched on a coverage_added event. The builder status is
 * read only for an admin (SessionInfo.user.is_admin, O-290); the api still answers 403 otherwise.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ApiComponents, ApiPaths } from "@g-tee-oh/contracts";

import { AUTO_CSRF_HEADER, problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { BuilderStatus } from "../contracts.js";
import { IDEMPOTENCY_HEADER } from "../trainer/idempotency.js";

export type CoverageRequestBody = ApiPaths["/api/v1/coverage/requests"]["post"]["requestBody"]["content"]["application/json"];
export type CoverageRequestResult = ApiPaths["/api/v1/coverage/requests"]["post"]["responses"]["202"]["content"]["application/json"];
export type BuilderSettingsPatch = ApiComponents["schemas"]["BuilderSettingsPatchInput"];
export type StoredBuilderSettings = BuilderStatus["settings"];

export const LIBRARY_QUERY_ROOT = "library";
/** The queue moves as the builder claims jobs; a coverage read is fresh for half a minute. */
export const COVERAGE_STALE_MS = 30 * 1000;
export const BUILDER_STALE_MS = 30 * 1000;

export function coverageKey(configId: string, pair: string) {
  return [LIBRARY_QUERY_ROOT, "coverage", configId, pair] as const;
}

export const BUILDER_STATUS_KEY = [LIBRARY_QUERY_ROOT, "builder"] as const;

export function coverageQuery(api: AppApi, configId: string, pair: string) {
  return queryOptions({
    queryKey: coverageKey(configId, pair),
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/coverage", {
        params: { query: { config_id: configId, pair } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: COVERAGE_STALE_MS,
    retry: false,
  });
}

export function builderStatusQuery(api: AppApi) {
  return queryOptions({
    queryKey: BUILDER_STATUS_KEY,
    queryFn: async (): Promise<BuilderStatus> => {
      const { data, error, response } = await api.client.GET("/api/v1/admin/builder");
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: BUILDER_STALE_MS,
    retry: false,
  });
}

function writeHeaders(idempotencyKey: string) {
  return { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: idempotencyKey };
}

/** POST /coverage/requests: raises a queued build or records the request; never a solve. */
export async function requestCoverage(api: AppApi, body: CoverageRequestBody, idempotencyKey: string): Promise<CoverageRequestResult> {
  const { data, error, response } = await api.client.POST("/api/v1/coverage/requests", {
    params: { header: writeHeaders(idempotencyKey) },
    body,
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

/** POST /admin/builder/pause or /resume; answers the builder status after the change. */
export async function setBuilderPaused(api: AppApi, paused: boolean, idempotencyKey: string): Promise<BuilderStatus> {
  const path = paused ? "/api/v1/admin/builder/pause" : "/api/v1/admin/builder/resume";
  const { data, error, response } = await api.client.POST(path, {
    params: { header: writeHeaders(idempotencyKey) },
    body: {},
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data;
}

/** PATCH /admin/builder/settings; answers every stored override after the change. */
export async function patchBuilderSettings(
  api: AppApi,
  patch: BuilderSettingsPatch,
  idempotencyKey: string,
): Promise<StoredBuilderSettings> {
  const { data, error, response } = await api.client.PATCH("/api/v1/admin/builder/settings", {
    params: { header: writeHeaders(idempotencyKey) },
    body: patch,
  });
  if (data === undefined) throw problemFromBody(response.status, error);
  return data.settings;
}

/** The status with new stored settings, as a new object (the cache is never mutated). */
export function withSettings(status: BuilderStatus, settings: StoredBuilderSettings): BuilderStatus {
  return { ...status, settings };
}
