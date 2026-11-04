/**
 * Tests for the node-switch budget pieces that run outside a browser (S45 follow-up, R3.26, item 10):
 * the bench loop renders the matrix and the right column's Overview for a rotation of synthetic nodes,
 * timing each switch with the study screen's own node-switch metrics, and the report the Playwright
 * spec writes judges the p95 strictly under the 50 ms budget, in the shape report.schema.json wants.
 */
import { describe, expect, it, vi } from "vitest";

import { NODE_SWITCH_BUDGET_MS, buildNodeSwitchReport } from "../../e2e/bench/node-switch-report.js";
import type { NodeSwitchBenchResult } from "../../src/bench/bench-api.js";
import { benchNodes, runNodeSwitchBench } from "../../src/bench/node-switch.js";

const MACHINE = { name: "zenbook", os: "win32 10.0.26200", cpu: "Test CPU", cores: 20, memory_gb: 32 };
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function result(p95: number): NodeSwitchBenchResult {
  return {
    n: 3,
    switchesMs: [1, 2, p95],
    p50: 2,
    p95,
    max: p95,
    warmupSwitches: 1,
    renderer: { string: "ANGLE (Test GPU)", kind: "gpu" },
    userAgent: "Mozilla/5.0 HeadlessChrome/140.0.0.0",
    nodes: 5,
  };
}

function report(p95: number) {
  return buildNodeSwitchReport({
    result: result(p95),
    machine: MACHINE,
    commit: COMMIT,
    date: "2026-10-30T12:00:00.000Z",
    browserVersion: "140.0.0.0",
    playwrightVersion: "1.64.1",
    concurrentWork: "none recorded",
  });
}

/** The fake clock's step per read. */
const CLOCK_TICK_MS = 1.5;

describe("R3.26 node-switch budget", () => {
  it("R3.26 the budget is 50 ms at p95, judged strictly", () => {
    expect(NODE_SWITCH_BUDGET_MS).toBe(50);
    expect(report(49.9).pass).toBe(true);
    expect(report(50).pass).toBe(false);
  });

  it("R3.26 the report names itself, its R ID, the judged p95 and the informational p50 and max", () => {
    const built = report(12.3456);
    expect(built).toMatchObject({ report: "node-switch", r_ids: ["R3.26"], commit: COMMIT, thresholds: { "switch/p95": { max: 50, unit: "ms" } } });
    expect(built.measurements).toEqual([
      { id: "switch/p95", value: 12.346, unit: "ms", threshold: { max: 50, unit: "ms" }, pass: true },
      { id: "switch/p50", value: 2, unit: "ms" },
      { id: "switch/max", value: 12.346, unit: "ms" },
    ]);
    expect(built.switch_times_ms).toEqual([1, 2, 12.346]);
  });

  it("R3.26 the bench nodes are study nodes the right column can show", () => {
    const nodes = benchNodes();
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) {
      expect(node.range_by_action).toHaveLength(node.actions.length);
      expect(node.street).toBe("preflop");
    }
  });

  it("R3.26 the loop times every switch with the node-switch metrics and leaves warm-up switches out", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let clock = 0;
    const container = document.createElement("div");
    document.body.append(container);
    const outcome = await runNodeSwitchBench({
      container,
      switches: 4,
      warmupSwitches: 2,
      now: () => (clock += CLOCK_TICK_MS),
      nextFrame: (callback) => {
        setTimeout(callback, 0);
      },
    });
    expect(outcome.n).toBe(4);
    expect(outcome.switchesMs).toHaveLength(4);
    expect(outcome.switchesMs.every((ms) => ms > 0)).toBe(true);
    // The metric reads the clock at markRequest and in the frame after complete: one 1.5 ms tick
    // apart. Each recorded switch is that measured duration, not a second clock around it (PR 52 review 1).
    expect(outcome.switchesMs).toEqual([CLOCK_TICK_MS, CLOCK_TICK_MS, CLOCK_TICK_MS, CLOCK_TICK_MS]);
    expect(outcome.p95).toBeGreaterThanOrEqual(outcome.p50);
    expect(outcome.nodes).toBe(benchNodes().length);
    // The loop unmounts its root when it is done, leaving the container empty.
    expect(container.childElementCount).toBe(0);
    container.remove();
    vi.restoreAllMocks();
  });
});
