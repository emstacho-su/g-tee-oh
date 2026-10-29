/**
 * The drill reads and writes behind /drills, /drills/new and /drills/$id (S26, R3.14, A5 section 3,
 * O-232, O-310, O-311).
 *
 * Mechanism: each function wraps one typed client call on the generated contract. A response
 * without data becomes a DrillProblem (problem.ts), which keeps the validation problem's field
 * errors for the builder and the import dialog. Every write sends AUTO_CSRF_HEADER (the client
 * fills the held token, O-197) and the caller's Idempotency-Key, one per user intent
 * (use-intent-mutation.ts), so a double click or a retry never writes twice (O-232).
 * - The list is newest first in cursor pages, filtered by one tag; the screen pages with
 *   useInfiniteQuery and next_cursor.
 * - The export code is read when the dialog opens and never cached past it (O-310: it is derived
 *   from the drill on every read, so it is cheap and always current).
 * - Duplicate (O-311) is client side: GET the drill, then POST /drills with copyName(name) and the
 *   same tags, spot filter and trainer settings, under the click's key. There is no duplicate
 *   route (A5 section 3).
 * After a write, invalidateDrills drops every drill read and the run screen's cached drill, so the
 * library, the builder and /drills/$id/run all show the drill as stored.
 */
import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { AUTO_CSRF_HEADER } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import { IDEMPOTENCY_HEADER } from "../trainer/idempotency.js";
import { TRAINER_QUERY_ROOT } from "../trainer/session-api.js";
import { copyName } from "./draft.js";
import { drillProblemFromBody } from "./problem.js";
import type { Drill, DrillCreate, DrillPage, DrillPatch } from "./types.js";

export const DRILLS_QUERY_ROOT = "drills";
/** Drills per list page; the api allows 1 to 200. */
export const DRILL_PAGE_LIMIT = 50;
/** A drill changes only through this screen, which invalidates it after every write. */
const DRILL_STALE_MS = 60 * 1000;

export function drillListKey(tag: string | undefined) {
  return [DRILLS_QUERY_ROOT, "list", tag ?? ""] as const;
}

export function drillDetailKey(id: string) {
  return [DRILLS_QUERY_ROOT, "detail", id] as const;
}

function writeHeaders(idempotencyKey: string) {
  return { ...AUTO_CSRF_HEADER, [IDEMPOTENCY_HEADER]: idempotencyKey };
}

export async function fetchDrillPage(api: AppApi, tag: string | undefined, cursor: string | undefined): Promise<DrillPage> {
  const { data, error, response } = await api.client.GET("/api/v1/drills", {
    params: {
      query: {
        limit: DRILL_PAGE_LIMIT,
        ...(tag === undefined ? {} : { tag }),
        ...(cursor === undefined ? {} : { cursor }),
      },
    },
  });
  if (data === undefined) throw drillProblemFromBody(response.status, error);
  return data;
}

/** One drill is enough to know a tag is in use. */
const PRESENCE_LIMIT = 1;

/**
 * Whether any drill of the user's carries this tag, from its own read (S47, PR #48 review HIGH 3):
 * GET /drills?tag=<tag>&limit=1, independent of the visible list's filter and pages. It sits under
 * the drills root, so invalidateDrills refreshes it after every write.
 */
export function tagInUseQuery(api: AppApi, tag: string) {
  return queryOptions({
    queryKey: [DRILLS_QUERY_ROOT, "tag-in-use", tag] as const,
    queryFn: async (): Promise<boolean> => {
      const { data, error, response } = await api.client.GET("/api/v1/drills", { params: { query: { limit: PRESENCE_LIMIT, tag } } });
      if (data === undefined) throw drillProblemFromBody(response.status, error);
      return data.items.length > 0;
    },
    staleTime: DRILL_STALE_MS,
    retry: false,
  });
}

export function drillListQuery(api: AppApi, tag: string | undefined) {
  return infiniteQueryOptions({
    queryKey: drillListKey(tag),
    queryFn: ({ pageParam }) => fetchDrillPage(api, tag, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: DrillPage) => page.next_cursor ?? undefined,
    staleTime: DRILL_STALE_MS,
    retry: false,
  });
}

export async function fetchDrill(api: AppApi, id: string): Promise<Drill> {
  const { data, error, response } = await api.client.GET("/api/v1/drills/{id}", { params: { path: { id } } });
  if (data === undefined) throw drillProblemFromBody(response.status, error);
  return data;
}

export function drillDetailQuery(api: AppApi, id: string) {
  return queryOptions({
    queryKey: drillDetailKey(id),
    queryFn: () => fetchDrill(api, id),
    staleTime: DRILL_STALE_MS,
    retry: false,
  });
}

export function drillExportQuery(api: AppApi, id: string) {
  return queryOptions({
    queryKey: [DRILLS_QUERY_ROOT, "export", id] as const,
    queryFn: async (): Promise<string> => {
      const { data, error, response } = await api.client.GET("/api/v1/drills/{id}/export", { params: { path: { id } } });
      if (data === undefined) throw drillProblemFromBody(response.status, error);
      return data.export_code;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export async function createDrill(api: AppApi, body: DrillCreate, idempotencyKey: string): Promise<Drill> {
  const { data, error, response } = await api.client.POST("/api/v1/drills", {
    params: { header: writeHeaders(idempotencyKey) },
    body,
  });
  if (data === undefined) throw drillProblemFromBody(response.status, error);
  return data;
}

export async function patchDrill(api: AppApi, id: string, body: DrillPatch, idempotencyKey: string): Promise<Drill> {
  const { data, error, response } = await api.client.PATCH("/api/v1/drills/{id}", {
    params: { path: { id }, header: writeHeaders(idempotencyKey) },
    body,
  });
  if (data === undefined) throw drillProblemFromBody(response.status, error);
  return data;
}

export async function deleteDrill(api: AppApi, id: string, idempotencyKey: string): Promise<void> {
  const { error, response } = await api.client.DELETE("/api/v1/drills/{id}", {
    params: { path: { id }, header: writeHeaders(idempotencyKey) },
  });
  if (!response.ok) throw drillProblemFromBody(response.status, error);
}

export async function importDrill(api: AppApi, exportCode: string, idempotencyKey: string): Promise<Drill> {
  const { data, error, response } = await api.client.POST("/api/v1/drills/import", {
    params: { header: writeHeaders(idempotencyKey) },
    body: { export_code: exportCode },
  });
  if (data === undefined) throw drillProblemFromBody(response.status, error);
  return data;
}

/** The DrillCreate body of a drill's duplicate (O-311). */
export function duplicateBody(drill: Drill): DrillCreate {
  return { name: copyName(drill.name), tags: [...drill.tags], spot_filter: drill.spot_filter, trainer: drill.trainer };
}

/** GET the drill as stored, then create its copy under the click's Idempotency-Key (O-311). */
export async function duplicateDrill(api: AppApi, id: string, idempotencyKey: string): Promise<Drill> {
  const source = await fetchDrill(api, id);
  return createDrill(api, duplicateBody(source), idempotencyKey);
}

/** Drops every drill read and the run screen's cached drill after a write. */
export async function invalidateDrills(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [DRILLS_QUERY_ROOT] }),
    queryClient.invalidateQueries({ queryKey: [TRAINER_QUERY_ROOT, "drill"] }),
  ]);
}
