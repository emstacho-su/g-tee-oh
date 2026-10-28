/**
 * The six progress reads behind /progress and the home cards (S32, R4.12, A5 section 3, S31's
 * routes, O-326).
 *
 * Mechanism: each function wraps one typed client call on the generated contract; a response
 * without data becomes an ApiProblem through problemFromBody, so callers branch on the status and
 * slug and never see the body. Tiers are computed on read by the api (O-252), so nothing here
 * caches a tier beyond the query. Every key sits under PROGRESS_QUERY_ROOT, so ending a session
 * refreshes every progress view with one invalidation (invalidateProgress, O-326). The track list
 * is paged by the api; it holds seven tracks (O-271), so the read follows next_cursor up to
 * MAX_TRACK_PAGES pages and fails loudly past that. The holdout read takes the newest
 * HOLDOUT_ROUNDS rounds (the api orders them newest first).
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { fetchAllPages } from "../api/fetch-all-pages.js";
import { problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type {
  LeakWeeks,
  ProgressHeatmap,
  ProgressHoldout,
  ProgressLeaks,
  ProgressRating,
  ProgressStreak,
  TrackProgress,
} from "./types.js";

export const PROGRESS_QUERY_ROOT = "progress";
/** Progress moves only when a session ends; a read stays fresh for half a minute. */
export const PROGRESS_STALE_MS = 30 * 1000;
export const TRACK_PAGE_LIMIT = 50;
export const MAX_TRACK_PAGES = 10;
/** A year of monthly holdout rounds. */
export const HOLDOUT_ROUNDS = 12;

export const progressKeys = {
  all: [PROGRESS_QUERY_ROOT] as const,
  rating: [PROGRESS_QUERY_ROOT, "rating"] as const,
  tracks: [PROGRESS_QUERY_ROOT, "tracks"] as const,
  leaks: (weeks: LeakWeeks) => [PROGRESS_QUERY_ROOT, "leaks", weeks] as const,
  heatmap: [PROGRESS_QUERY_ROOT, "heatmap"] as const,
  holdout: [PROGRESS_QUERY_ROOT, "holdout"] as const,
  streak: [PROGRESS_QUERY_ROOT, "streak"] as const,
};

/** A remount inside the stale time reuses the read; ending a session invalidates them all (O-326). */
const shared = { staleTime: PROGRESS_STALE_MS, retry: false } as const;

export function ratingQuery(api: AppApi) {
  return queryOptions({
    queryKey: progressKeys.rating,
    queryFn: async (): Promise<ProgressRating> => {
      const { data, error, response } = await api.client.GET("/api/v1/progress/rating");
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    ...shared,
  });
}

/** Every track, following the api's cursor (seven in v1, O-271). */
export async function fetchAllTracks(api: AppApi): Promise<TrackProgress[]> {
  const fetchPage = async (cursor: string | undefined) => {
    const query = cursor === undefined ? { limit: TRACK_PAGE_LIMIT } : { limit: TRACK_PAGE_LIMIT, cursor };
    const { data, error, response } = await api.client.GET("/api/v1/progress/tracks", { params: { query } });
    if (data === undefined) throw problemFromBody(response.status, error);
    return data;
  };
  return fetchAllPages(fetchPage, MAX_TRACK_PAGES, "the track list");
}

export function tracksQuery(api: AppApi) {
  return queryOptions({ queryKey: progressKeys.tracks, queryFn: () => fetchAllTracks(api), ...shared });
}

export function leaksQuery(api: AppApi, weeks: LeakWeeks) {
  return queryOptions({
    queryKey: progressKeys.leaks(weeks),
    queryFn: async (): Promise<ProgressLeaks> => {
      const { data, error, response } = await api.client.GET("/api/v1/progress/leaks", { params: { query: { weeks } } });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    ...shared,
  });
}

export function heatmapQuery(api: AppApi) {
  return queryOptions({
    queryKey: progressKeys.heatmap,
    queryFn: async (): Promise<ProgressHeatmap> => {
      const { data, error, response } = await api.client.GET("/api/v1/progress/heatmap");
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    ...shared,
  });
}

export function holdoutQuery(api: AppApi) {
  return queryOptions({
    queryKey: progressKeys.holdout,
    queryFn: async (): Promise<ProgressHoldout> => {
      const { data, error, response } = await api.client.GET("/api/v1/progress/holdout", {
        params: { query: { limit: HOLDOUT_ROUNDS } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    ...shared,
  });
}

export function streakQuery(api: AppApi) {
  return queryOptions({
    queryKey: progressKeys.streak,
    queryFn: async (): Promise<ProgressStreak> => {
      const { data, error, response } = await api.client.GET("/api/v1/progress/streak");
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    ...shared,
  });
}

/** Marks every progress read stale and refetches the ones on screen (O-326). */
export function invalidateProgress(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: progressKeys.all });
}
