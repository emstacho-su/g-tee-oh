/**
 * Read helpers shared by the study and library hooks (S39 review round 1, R3.12): useStudyCatalog
 * (/library), useStudyEntry and useLineNodes (/study) and useChildStreets (the carousel).
 *
 * combineReads folds several TanStack queries into one loading flag, the first failure (or null)
 * and a retry that refetches only the failed reads, so a screen shows one error state with one
 * retry and never an uncaught error. gatedPairsQuery reads a configuration's pairs only once its
 * config_id is known; the placeholder key is never fetched.
 */
import type { AppApi } from "../api/index.js";
import { pairsQuery } from "./queries.js";

/** The part of a query result the helpers read. */
export interface ReadState {
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch: () => Promise<unknown>;
}

export interface CombinedReads {
  readonly loading: boolean;
  readonly error: unknown;
  readonly retry: () => void;
}

export function combineReads(reads: readonly ReadState[]): CombinedReads {
  const failed = reads.filter((read) => read.isError);
  return {
    loading: reads.some((read) => read.isFetching),
    error: failed[0]?.error ?? null,
    retry: () => {
      for (const read of failed) void read.refetch();
    },
  };
}

/** Never fetched: the gate keeps the query disabled until a real config_id arrives. */
const UNUSED_CONFIG_ID = "";

export type GatedPairsQuery = ReturnType<typeof pairsQuery> & { enabled: boolean };

export function gatedPairsQuery(api: AppApi, configId: string | undefined): GatedPairsQuery {
  return { ...pairsQuery(api, configId ?? UNUSED_CONFIG_ID), enabled: configId !== undefined };
}
