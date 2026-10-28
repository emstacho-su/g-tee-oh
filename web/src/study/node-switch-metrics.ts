/**
 * Node switch timing for the study screen (S25, R3.12, O-287).
 *
 * Mechanism: the screen calls markRequest when the user asks for another node (a pair choice, an
 * action that moves down the line, a breadcrumb step) and complete when the new node's matrix has
 * rendered. complete takes the pending start, schedules one frame (requestAnimationFrame by
 * default) and in that frame logs "g-tee-oh node-switch <ms> ms <line or root>" through
 * console.info, so the number covers the request, the render and the matrix's own draw frame,
 * which React scheduled first. A render with nothing pending logs nothing, a newer request
 * replaces an older one, and cancel drops a pending one (the node failed, or it has no matrix), so
 * there is one line per switch. Flow 3 collects these lines into test-results/node-switch.json;
 * they are dev-stack numbers for the latency report, never the O-40 guard (S29). The clock, the
 * frame scheduler and the log are injectable for tests; the defaults are read at call time.
 * console.info is allowed here only, for O-287.
 */
import { createContext, useContext } from "react";

export const NODE_SWITCH_PREFIX = "g-tee-oh node-switch";
const MS_DECIMALS = 1;

export interface NodeSwitchMetricsOptions {
  now?: () => number;
  nextFrame?: (callback: () => void) => void;
  log?: (line: string) => void;
}

export interface NodeSwitchMetrics {
  markRequest(): void;
  complete(line: string): void;
  cancel(): void;
}

export function formatNodeSwitchLine(ms: number, line: string): string {
  return `${NODE_SWITCH_PREFIX} ${ms.toFixed(MS_DECIMALS)} ms ${line}`;
}

const defaultNow = (): number => performance.now();
const defaultNextFrame = (callback: () => void): void => {
  window.requestAnimationFrame(() => callback());
};
// O-287: the node switch line is the one console.info the web writes; flow 3 reads it.
const defaultLog = (line: string): void => console.info(line);

export function createNodeSwitchMetrics(options: NodeSwitchMetricsOptions = {}): NodeSwitchMetrics {
  const now = options.now ?? defaultNow;
  const nextFrame = options.nextFrame ?? defaultNextFrame;
  const log = options.log ?? defaultLog;
  let pendingStart: number | null = null;

  return {
    markRequest() {
      pendingStart = now();
    },
    complete(line) {
      const start = pendingStart;
      if (start === null) return;
      pendingStart = null;
      nextFrame(() => log(formatNodeSwitchLine(now() - start, line)));
    },
    cancel() {
      pendingStart = null;
    },
  };
}

/** Records nothing: the context's value outside a study page. */
export const INERT_NODE_SWITCH_METRICS: NodeSwitchMetrics = {
  markRequest: () => undefined,
  complete: () => undefined,
  cancel: () => undefined,
};

/** The study page provides its own metrics, created once per mount, so no state outlives a page. */
export const NodeSwitchMetricsContext = createContext<NodeSwitchMetrics>(INERT_NODE_SWITCH_METRICS);

export function useNodeSwitchMetrics(): NodeSwitchMetrics {
  return useContext(NodeSwitchMetricsContext);
}
