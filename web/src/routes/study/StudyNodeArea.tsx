/**
 * The node read of the study screen (S25, S39, R3.12, A5 section 3, O-286, O-287, O-396, O-397).
 * It mounts only once the settings are confirmed and name a covered pair, reads the node at the
 * URL's line through studyNodeQuery, prefetches the next likely node as soon as one arrives, and
 * renders the explicit states: loading, the failure alert (404 without a retry; 502, 503 and other
 * failures with one) or the node. A failed read cancels the pending node switch timing, so a later
 * success is not measured from the failed request.
 *
 * S39: the node view carries the position carousel, built from the nodes above this one on the
 * line (useLineNodes), this node and the streets of its children (useChildStreets, so an action
 * into a postflop node is disabled). Until the line's nodes have loaded the carousel area says so;
 * a failed read there shows its own alert with a retry, and the matrix still shows. Review round
 * 1: a failed node read also offers LineEscape (one decision back, or the spot's start), built
 * from the URL alone, since no carousel can show then.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AppApi } from "../../api/index.js";
import type { MatrixMode } from "../../components/range-matrix/model.js";
import { LoadingNote } from "../../components/ui/index.js";
import type { StudyNode } from "../../contracts.js";
import type { Position } from "../../drills/types.js";
import { carouselItems, lineDecisions, type CarouselPair } from "../../study/carousel.js";
import { useNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import { usePrefetchNextLikely } from "../../study/prefetch.js";
import { nodeFailure } from "../../study/problem-text.js";
import { studyNodeQuery } from "../../study/queries.js";
import type { StudySearch } from "../../study/search.js";
import { useChildStreets, useLineNodes } from "../../study/use-line-nodes.js";
import { LineEscape } from "./LineEscape.js";
import { NodeView } from "./NodeView.js";
import { PositionCarousel } from "./PositionCarousel.js";
import { FailureAlert } from "./StudyNotices.js";

export interface StudyNodeAreaProps {
  api: AppApi;
  configId: string;
  pair: CarouselPair & { readonly pair: string };
  /** The table's seats in action order. */
  seats: readonly Position[];
  search: StudySearch;
  onModeChange: (mode: MatrixMode) => void;
  onSelectHand: (hand: string) => void;
  onOpenLine: (line: string) => void;
  /** Compare to best: another action to compare (S45, R3.24). */
  onLensChange: (lens: number) => void;
  /** The action filter set (S45, R3.12, O-468). */
  onFiltersChange: (filters: readonly number[], compare?: number) => void;
}

interface LineCarouselProps {
  api: AppApi;
  configId: string;
  pair: StudyNodeAreaProps["pair"];
  seats: readonly Position[];
  node: StudyNode;
  line: string | undefined;
  onOpenLine: (line: string) => void;
}

function LineCarousel({ api, configId, pair, seats, node, line, onOpenLine }: LineCarouselProps) {
  const { ancestors, error, retry } = useLineNodes(api, configId, pair.pair, line);
  const childStreets = useChildStreets(api, configId, pair.pair, line, node);
  if (error !== null) return <FailureAlert failure={nodeFailure(error)} onRetry={retry} />;
  if (ancestors === undefined) return <LoadingNote text="Loading the line." />;
  const items = carouselItems(seats, pair, lineDecisions([...ancestors, node], line));
  return (
    <PositionCarousel
      key={line ?? ""}
      items={items}
      node={node}
      line={line}
      childStreets={childStreets}
      onOpenLine={onOpenLine}
    />
  );
}

export function StudyNodeArea({ api, configId, pair, seats, search, onModeChange, onSelectHand, onOpenLine, onLensChange, onFiltersChange }: StudyNodeAreaProps) {
  const metrics = useNodeSwitchMetrics();
  const node = useQuery(studyNodeQuery(api, { configId, pair: pair.pair, line: search.line ?? "" }));
  usePrefetchNextLikely(api, node.data, configId, pair.pair);
  const failed = node.isError;
  useEffect(() => {
    if (failed) metrics.cancel();
  }, [failed, metrics]);

  if (node.isPending) return <LoadingNote text="Loading the node." />;
  if (node.isError) {
    return (
      <>
        <FailureAlert failure={nodeFailure(node.error)} onRetry={() => void node.refetch()} />
        <LineEscape line={search.line} onOpenLine={onOpenLine} />
      </>
    );
  }
  const carousel = (
    <LineCarousel
      api={api}
      configId={configId}
      pair={pair}
      seats={seats}
      node={node.data}
      line={search.line}
      onOpenLine={onOpenLine}
    />
  );
  return (
    <NodeView
      api={api}
      node={node.data}
      search={search}
      carousel={carousel}
      onModeChange={onModeChange}
      onSelectHand={onSelectHand}
      onOpenLine={onOpenLine}
      onLensChange={onLensChange}
      onFiltersChange={onFiltersChange}
    />
  );
}
