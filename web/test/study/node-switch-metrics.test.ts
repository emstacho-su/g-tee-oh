// Tests for the node switch timing (S25, R3.12, O-287) with an injected clock, frame scheduler and
// log: one line per switch, measured from the request to the first frame after the new matrix.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INERT_NODE_SWITCH_METRICS,
  NODE_SWITCH_PREFIX,
  createNodeSwitchMetrics,
  formatNodeSwitchLine,
} from "../../src/study/node-switch-metrics.js";

function fakeEnvironment(times: number[]) {
  const frames: (() => void)[] = [];
  const lines: string[] = [];
  const metrics = createNodeSwitchMetrics({
    now: () => times.shift() ?? Number.NaN,
    nextFrame: (callback) => frames.push(callback),
    log: (line) => lines.push(line),
  });
  const flush = () => frames.splice(0).forEach((callback) => callback());
  return { metrics, frames, lines, flush };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R3.12 node switch metrics", () => {
  it("R3.12 logs the time from the request to the frame after the matrix rendered, once", () => {
    const { metrics, lines, flush } = fakeEnvironment([100, 142.25]);
    metrics.markRequest();
    metrics.complete("r250");
    expect(lines).toEqual([]);
    flush();
    expect(lines).toEqual(["g-tee-oh node-switch 42.3 ms r250"]);
    metrics.complete("r250");
    flush();
    expect(lines).toHaveLength(1);
  });

  it("R3.12 a render without a pending request logs nothing", () => {
    const { metrics, frames, lines } = fakeEnvironment([1, 2]);
    metrics.complete("root");
    expect(frames).toHaveLength(0);
    expect(lines).toEqual([]);
  });

  it("R3.12 a newer request replaces the pending one and cancel drops it", () => {
    const { metrics, lines, flush } = fakeEnvironment([10, 50, 70, 200, 300]);
    metrics.markRequest();
    metrics.markRequest();
    metrics.complete("root");
    flush();
    expect(lines).toEqual(["g-tee-oh node-switch 20.0 ms root"]);
    metrics.markRequest();
    metrics.cancel();
    metrics.complete("root");
    flush();
    expect(lines).toHaveLength(1);
  });

  it("R3.12 the default log is console.info with the O-287 prefix and the default clock is performance.now", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(5).mockReturnValueOnce(12);
    const frames: (() => void)[] = [];
    const metrics = createNodeSwitchMetrics({ nextFrame: (callback) => frames.push(callback) });
    metrics.markRequest();
    metrics.complete("r250.r1100");
    frames.forEach((callback) => callback());
    expect(now).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledExactlyOnceWith("g-tee-oh node-switch 7.0 ms r250.r1100");
    expect(formatNodeSwitchLine(1.04, "root")).toBe(`${NODE_SWITCH_PREFIX} 1.0 ms root`);
  });

  it("R3.12 outside a study page the context's metrics record nothing", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    INERT_NODE_SWITCH_METRICS.markRequest();
    INERT_NODE_SWITCH_METRICS.complete("root");
    INERT_NODE_SWITCH_METRICS.cancel();
    expect(info).not.toHaveBeenCalled();
  });

  it("R3.12 the default frame scheduler is requestAnimationFrame", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const metrics = createNodeSwitchMetrics({ now: () => 0, log: () => undefined });
    metrics.markRequest();
    metrics.complete("root");
    expect(raf).toHaveBeenCalledOnce();
  });
});
