/**
 * The nodes above the current one on the URL's line (S39, R3.12, O-396): the root and every
 * prefix before the line itself, which the position carousel needs for each earlier decision's
 * seat and action label.
 *
 * Mechanism: one studyNodeQuery per prefix, with the same query keys as the main node read and
 * the next-likely prefetch, so walking forward through the carousel is all cache hits; a deep
 * link costs one read per step, each through the api's node cache. The nodes are reported only
 * once every one has loaded; a failed read is reported with a retry of the failed reads only.
 */
import { useQueries } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import type { StudyNode } from "../contracts.js";
import { linePrefixes } from "./line.js";
import { studyNodeQuery } from "./queries.js";

export interface LineNodes {
  /** The nodes at every prefix before the line, root first; undefined while any is loading. */
  readonly ancestors: readonly StudyNode[] | undefined;
  readonly error: unknown;
  readonly retry: () => void;
}

export function useLineNodes(api: AppApi, configId: string, pair: string, line: string | undefined): LineNodes {
  const prefixes = linePrefixes(line).slice(0, -1);
  const reads = useQueries({ queries: prefixes.map((prefix) => studyNodeQuery(api, { configId, pair, line: prefix })) });
  const failed = reads.filter((read) => read.isError);
  const loaded = reads.every((read) => read.data !== undefined);
  return {
    ancestors: loaded ? reads.map((read) => read.data) : undefined,
    error: failed[0]?.error ?? null,
    retry: () => {
      for (const read of failed) void read.refetch();
    },
  };
}
