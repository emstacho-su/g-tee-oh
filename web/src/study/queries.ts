/**
 * Query options for the catalog and study reads (S25, R3.12, R3.13, A5 section 3). The study
 * screen, the trainer's feedback panel and the next-likely-node prefetch all use these factories,
 * so one node read has one query key wherever it happens and a prefetch is a real cache hit
 * (O-286).
 *
 * Mechanism: each factory wraps one typed client call; a response without data becomes an
 * ApiProblem through problemFromBody, so callers see the problem slug and status and never the
 * raw body. Library reads are immutable for a published solution, so nodes and insights stay
 * fresh for STUDY_STALE_MS; the catalog changes only with a migration.
 */
import { queryOptions } from "@tanstack/react-query";

import { problemFromBody } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import type { ApiComponents } from "@g-tee-oh/contracts";

type Schemas = ApiComponents["schemas"];
export type Stake = Schemas["Stake"];
export type GameConfig = Schemas["GameConfig"];
export type PositionPairEntry = Schemas["PositionPairEntry"];

/** A published solution's nodes never change, so a read stays fresh for ten minutes. */
export const STUDY_STALE_MS = 10 * 60 * 1000;
/** The catalog changes only with a migration. */
export const CATALOG_STALE_MS = 30 * 60 * 1000;
/** The catalog is small: one page holds every stake, configuration and pair (A4 section 1). */
export const CATALOG_PAGE_LIMIT = 100;

export interface StudyNodeParams {
  configId: string;
  pair: string;
  /** The dot-separated action tokens from the pair's root; "" or undefined is the root. */
  line?: string;
}

export interface StudyInsightsParams {
  solutionId: string;
  nodeKey: string;
  hand: string;
}

export interface ConfigsParams {
  format: "online" | "live";
  tableSize: number;
  stakeId: string;
}

export const STUDY_QUERY_ROOT = "study";
export const CATALOG_QUERY_ROOT = "catalog";

export function studyNodeKey({ configId, pair, line }: StudyNodeParams) {
  return [STUDY_QUERY_ROOT, "node", configId, pair, line ?? ""] as const;
}

export function studyNodeQuery(api: AppApi, params: StudyNodeParams) {
  return queryOptions({
    queryKey: studyNodeKey(params),
    queryFn: async () => {
      const line = params.line === undefined || params.line === "" ? {} : { line: params.line };
      const { data, error, response } = await api.client.GET("/api/v1/study/node", {
        params: { query: { config_id: params.configId, pair: params.pair, ...line } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: STUDY_STALE_MS,
    retry: false,
  });
}

export interface StudyNodeByKeyParams {
  configId: string;
  pair: string;
  /** A node key the api handed out (DecisionFeedback.node_key, a next_likely_node_key). */
  nodeKey: string;
}

export function studyNodeByKeyKey({ configId, pair, nodeKey }: StudyNodeByKeyParams) {
  return [STUDY_QUERY_ROOT, "node-key", configId, pair, nodeKey] as const;
}

/**
 * The node a key names (S25 lane C, R3.13, O-281): the trainer's feedback panel knows the decided
 * node by its key, not by its line, and GET /study/node takes node_key in place of line (O-245).
 */
export function studyNodeByKeyQuery(api: AppApi, params: StudyNodeByKeyParams) {
  return queryOptions({
    queryKey: studyNodeByKeyKey(params),
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/study/node", {
        params: { query: { config_id: params.configId, pair: params.pair, node_key: params.nodeKey } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: STUDY_STALE_MS,
    retry: false,
  });
}

export function studyInsightsQuery(api: AppApi, params: StudyInsightsParams) {
  return queryOptions({
    queryKey: [STUDY_QUERY_ROOT, "insights", params.solutionId, params.nodeKey, params.hand] as const,
    queryFn: async () => {
      const { data, error, response } = await api.client.GET("/api/v1/study/insights", {
        params: { query: { solution_id: params.solutionId, node_key: params.nodeKey, hand: params.hand } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data;
    },
    staleTime: STUDY_STALE_MS,
    retry: false,
  });
}

export function stakesQuery(api: AppApi) {
  return queryOptions({
    queryKey: [CATALOG_QUERY_ROOT, "stakes"] as const,
    queryFn: async (): Promise<Stake[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/stakes", {
        params: { query: { limit: CATALOG_PAGE_LIMIT } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

export function configsQuery(api: AppApi, params: ConfigsParams) {
  return queryOptions({
    queryKey: [CATALOG_QUERY_ROOT, "configs", params.format, params.tableSize, params.stakeId] as const,
    queryFn: async (): Promise<GameConfig[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/configs", {
        params: {
          query: {
            format: params.format,
            table_size: params.tableSize,
            stake_id: params.stakeId,
            limit: CATALOG_PAGE_LIMIT,
          },
        },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

export function pairsQuery(api: AppApi, configId: string) {
  return queryOptions({
    queryKey: [CATALOG_QUERY_ROOT, "pairs", configId] as const,
    queryFn: async (): Promise<PositionPairEntry[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/configs/{id}/pairs", {
        params: { path: { id: configId }, query: { limit: CATALOG_PAGE_LIMIT } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

/**
 * Every configuration of one format, over all table sizes and stakes (S25, R3.12). The study
 * filters derive the table size, stake and depth choices from this one list and resolve the
 * config_id from it (src/study/filters.ts), so choosing a filter never waits on another read.
 * configsQuery stays the narrower read for callers that already know all three filters.
 */
export function formatConfigsQuery(api: AppApi, format: ConfigsParams["format"]) {
  return queryOptions({
    queryKey: [CATALOG_QUERY_ROOT, "configs-of-format", format] as const,
    queryFn: async (): Promise<GameConfig[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/configs", {
        params: { query: { format, limit: CATALOG_PAGE_LIMIT } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}
