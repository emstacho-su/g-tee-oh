/**
 * The node read of the study screen (S25, R3.12, A5 section 3, O-286, O-287). It mounts only once
 * the config_id and a covered pair are known, reads the node at the URL's line through
 * studyNodeQuery, prefetches the next likely node as soon as one arrives, and renders the explicit
 * states: loading, the failure alert (404 without a retry; 502, 503 and other failures with one)
 * or the node. A failed read cancels the pending node switch timing, so a later success is not
 * measured from the failed request.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AppApi } from "../../api/index.js";
import type { MatrixMode } from "../../components/range-matrix/model.js";
import { useNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import { usePrefetchNextLikely } from "../../study/prefetch.js";
import { nodeFailure } from "../../study/problem-text.js";
import { studyNodeQuery } from "../../study/queries.js";
import type { StudySearch } from "../../study/search.js";
import { NodeView } from "./NodeView.js";
import { FailureAlert, LoadingNote } from "./StudyNotices.js";

export interface StudyNodeAreaProps {
  api: AppApi;
  configId: string;
  pair: string;
  search: StudySearch;
  onModeChange: (mode: MatrixMode) => void;
  onSelectHand: (hand: string) => void;
}

export function StudyNodeArea({ api, configId, pair, search, onModeChange, onSelectHand }: StudyNodeAreaProps) {
  const metrics = useNodeSwitchMetrics();
  const node = useQuery(studyNodeQuery(api, { configId, pair, line: search.line ?? "" }));
  usePrefetchNextLikely(api, node.data, configId, pair);
  const failed = node.isError;
  useEffect(() => {
    if (failed) metrics.cancel();
  }, [failed, metrics]);

  if (node.isPending) return <LoadingNote text="Loading the node." />;
  if (node.isError) return <FailureAlert failure={nodeFailure(node.error)} onRetry={() => void node.refetch()} />;
  return <NodeView api={api} node={node.data} search={search} onModeChange={onModeChange} onSelectHand={onSelectHand} />;
}
