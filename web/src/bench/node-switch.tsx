/**
 * The node-switch bench loop (S45 follow-up, R3.26, item 10, design rule 12: speed per node switch is
 * the feel of a solver browser).
 *
 * Mechanism: a React root renders what a study node switch redraws, the range matrix and the right
 * column's Overview (the range by action table and the advantage card, its read answered offline by
 * benchApi), for a rotation of synthetic study nodes (the frame
 * bench's variants, so every switch draws different data). Each switch marks a request on the
 * study screen's own node-switch metrics (node-switch-metrics.ts), renders the next node, and the
 * harness completes the switch in an effect after the commit, exactly as NodeView does; the metrics
 * measure one frame later, and the duration they measure is the one recorded, never a second clock
 * around it (PR 52 review 1). Warm-up switches are not recorded. The clock
 * and the frame scheduler are injected, so the loop runs in jsdom for the unit tests; the bench
 * page passes performance.now and requestAnimationFrame. Synthetic numbers only (O-26).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import { createAppApi, type AppApi } from "../api/index.js";
import { RangeMatrix } from "../components/range-matrix/RangeMatrix.js";
import type { StudyNode } from "../contracts.js";
import { fixtureInsights, fixtureStudyNode } from "../fixtures/index.js";
import { AdvantageInsights } from "../routes/study/HandInsights.js";
import { NodeActionsPanel } from "../routes/study/NodeActionsPanel.js";
import { createNodeSwitchMetrics, type NodeSwitchMetrics } from "../study/node-switch-metrics.js";
import { nearestRank } from "./stats.js";
import { benchVariants } from "./variants.js";

export const DEFAULT_NODE_SWITCHES = 60;
export const DEFAULT_WARMUP_SWITCHES = 5;
/** A switch whose frame never comes fails the run instead of hanging it (PR 52 review round 2). */
export const DEFAULT_SWITCH_TIMEOUT_MS = 10_000;
const BENCH_SIZE_PX = 520;
const P50 = 0.5;
const P95 = 0.95;
const JSON_HEADERS = { "content-type": "application/json" } as const;

export interface NodeSwitchRunInput {
  readonly container: HTMLElement;
  readonly switches: number;
  readonly warmupSwitches: number;
  readonly now: () => number;
  readonly nextFrame: (callback: () => void) => void;
  /** How long one switch may take before the run fails; DEFAULT_SWITCH_TIMEOUT_MS by default. */
  readonly switchTimeoutMs?: number;
}

/**
 * The api the right column reads from during the bench: every read answers the synthetic insights
 * fixture (O-26), so the Overview's advantage card mounts and settles offline and a switch covers
 * what the study screen redraws (PR 52 review round 2).
 */
function benchApi(): AppApi {
  const fetch = () => Promise.resolve(new Response(JSON.stringify(fixtureInsights), { status: 200, headers: JSON_HEADERS }));
  return createAppApi({ baseUrl: window.location.origin, fetch });
}

export interface NodeSwitchTimings {
  readonly n: number;
  readonly switchesMs: readonly number[];
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly warmupSwitches: number;
  readonly nodes: number;
}

/** The frame bench's variants as study nodes the right column can show, built once. */
export function benchNodes(): readonly StudyNode[] {
  return benchVariants().map((variant, index) => ({
    ...fixtureStudyNode,
    node_key: `synthetic:bench-${index}`,
    actions: [...variant.actions],
    hands: [...variant.hands],
    range_by_action: variant.actions.map((action) => ({ index: action.index, share: 1 / variant.actions.length })),
  }));
}

interface HarnessProps {
  api: AppApi;
  node: StudyNode;
  metrics: NodeSwitchMetrics;
}

/** What a node switch redraws on the study screen: the matrix and the Overview (the actions and the advantage card), completing the switch after its commit. */
function NodeSwitchHarness({ api, node, metrics }: HarnessProps) {
  useEffect(() => {
    metrics.complete(node.node_key);
  }, [metrics, node.node_key]);
  return (
    <div>
      <RangeMatrix node={node} mode="frequency" theme="light" sizePx={BENCH_SIZE_PX} onSelectHand={() => undefined} popOut={false} />
      <NodeActionsPanel node={node} hand={undefined} />
      <AdvantageInsights api={api} node={node} hand={undefined} />
    </div>
  );
}

export async function runNodeSwitchBench(input: NodeSwitchRunInput): Promise<NodeSwitchTimings> {
  const nodes = benchNodes();
  const root = createRoot(input.container);
  const api = benchApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const timeoutMs = input.switchTimeoutMs ?? DEFAULT_SWITCH_TIMEOUT_MS;
  let finish: ((ms: number) => void) | null = null;
  const metrics = createNodeSwitchMetrics({
    now: input.now,
    nextFrame: input.nextFrame,
    measure: (ms) => finish?.(ms),
    log: () => undefined,
  });
  const recorded: number[] = [];
  try {
    const total = input.warmupSwitches + input.switches;
    for (let index = 0; index < total; index += 1) {
      const node = nodes[index % nodes.length];
      if (node === undefined) throw new RangeError("node-switch bench: no synthetic nodes");
      const measured = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`node-switch bench: switch ${index} timed out after ${timeoutMs} ms`)), timeoutMs);
        finish = (ms) => {
          clearTimeout(timer);
          resolve(ms);
        };
      });
      metrics.markRequest();
      flushSync(() =>
        root.render(
          <QueryClientProvider client={client}>
            <NodeSwitchHarness api={api} node={node} metrics={metrics} />
          </QueryClientProvider>,
        ),
      );
      const elapsed = await measured;
      if (index >= input.warmupSwitches) recorded.push(elapsed);
    }
  } finally {
    root.unmount();
    client.clear();
  }
  const sorted = [...recorded].sort((left, right) => left - right);
  return {
    n: sorted.length,
    switchesMs: sorted,
    p50: nearestRank(sorted, P50),
    p95: nearestRank(sorted, P95),
    max: nearestRank(sorted, 1),
    warmupSwitches: input.warmupSwitches,
    nodes: nodes.length,
  };
}
