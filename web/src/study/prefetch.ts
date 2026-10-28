/**
 * Prefetch of the next likely node (S25, R3.12, O-286).
 *
 * Mechanism: as soon as a node arrives, the screen prefetches the node at its next_likely_line
 * through queryClient.prefetchQuery with studyNodeQuery, the same query options and key the
 * screen reads with, so stepping down the likeliest action is a cache hit. This sits on top of the
 * api's own server-side prefetch (R3.3). A node whose likeliest action ends the solution has no
 * next likely line and prefetches nothing. prefetchQuery never throws: a failed prefetch leaves
 * the cache empty and the real read on the click shows its own error state, so nothing is lost.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AppApi } from "../api/index.js";
import type { StudyNode } from "../contracts.js";
import { studyNodeQuery, type StudyNodeParams } from "./queries.js";

/** The read the next likely node needs, or null when the node names none. */
export function nextLikelyParams(node: Pick<StudyNode, "next_likely_line">, configId: string, pair: string): StudyNodeParams | null {
  return node.next_likely_line === null ? null : { configId, pair, line: node.next_likely_line };
}

export function usePrefetchNextLikely(api: AppApi, node: StudyNode | undefined, configId: string, pair: string): void {
  const queryClient = useQueryClient();
  const params = node === undefined ? null : nextLikelyParams(node, configId, pair);
  const line = params?.line;
  useEffect(() => {
    if (line === undefined) return;
    void queryClient.prefetchQuery(studyNodeQuery(api, { configId, pair, line }));
  }, [api, queryClient, configId, pair, line]);
}
