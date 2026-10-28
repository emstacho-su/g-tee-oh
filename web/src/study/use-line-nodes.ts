/**
 * The nodes the position carousel reads besides the current one (S39, R3.12, O-396, O-397).
 *
 * useLineNodes: the root and every prefix before the URL's line, for each earlier decision's seat
 * and action label. useChildStreets: the street of each child an action at the current node leads
 * to, so an action into a postflop node is shown disabled with the v1.5 reason (review round 1);
 * the web never infers a street from the key grammar or a poker rule.
 *
 * Mechanism: one studyNodeQuery per line, with the same query keys as the main node read and the
 * next-likely prefetch, so walking forward is all cache hits and a child read now is the node read
 * a later click makes. Ancestors are reported once every one has loaded; a failed read comes with a
 * retry of the failed reads only (combineReads). A child still loading or failing has no street:
 * its action stays enabled, and following it leads to the node's own failure or postflop state,
 * each with a way back.
 */
import { useQueries } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import type { StudyNode, Street } from "../contracts.js";
import { childLine, linePrefixes } from "./line.js";
import { studyNodeQuery } from "./queries.js";
import { combineReads } from "./reads.js";

export interface LineNodes {
  /** The nodes at every prefix before the line, root first; undefined while any is loading. */
  readonly ancestors: readonly StudyNode[] | undefined;
  readonly error: unknown;
  readonly retry: () => void;
}

export function useLineNodes(api: AppApi, configId: string, pair: string, line: string | undefined): LineNodes {
  const prefixes = linePrefixes(line).slice(0, -1);
  const reads = useQueries({ queries: prefixes.map((prefix) => studyNodeQuery(api, { configId, pair, line: prefix })) });
  const loaded = reads.every((read) => read.data !== undefined);
  const { error, retry } = combineReads(reads);
  return {
    ancestors: loaded ? reads.map((read) => read.data).filter((node) => node !== undefined) : undefined,
    error,
    retry,
  };
}

/** The known street of each continuing action's child, by token; absent while unknown. */
export type ChildStreets = ReadonlyMap<string, Street>;

export function useChildStreets(
  api: AppApi,
  configId: string,
  pair: string,
  line: string | undefined,
  node: Pick<StudyNode, "actions">,
): ChildStreets {
  const continuing = node.actions.filter((action) => action.next_node_key !== null);
  const reads = useQueries({
    queries: continuing.map((action) => studyNodeQuery(api, { configId, pair, line: childLine(line, action.token) })),
  });
  return new Map(
    continuing.flatMap((action, index) => {
      const street = reads[index]?.data?.street;
      return street === undefined ? [] : [[action.token, street] as const];
    }),
  );
}
