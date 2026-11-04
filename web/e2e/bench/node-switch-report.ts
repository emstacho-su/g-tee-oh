/**
 * Builds the node-switch report from a bench run (S45 follow-up, R3.26, item 10).
 *
 * Mechanism: a pure function from the page's NodeSwitchBenchResult plus the machine, commit, date,
 * browser and Playwright versions to the JSON envelope of validation/reports/report.schema.json
 * (report "node-switch", r_ids R3.26). The p95 of the switch times is judged, strictly under
 * NODE_SWITCH_BUDGET_MS; p50 and max are informational, with no pass field, so the report's verdict
 * agrees with its judged measurement as scripts/check-reports.mjs requires. Every recorded switch
 * time is kept so a reader can recompute the percentiles.
 */
import type { NodeSwitchBenchResult } from "../../src/bench/bench-api.js";
import type { MachineInfo, ReportMeasurement } from "./report.js";

export const NODE_SWITCH_BUDGET_MS = 50;
export const NODE_SWITCH_REPORT_ID = "node-switch";
const R_ID = "R3.26";
const UNIT = "ms";
const DECIMALS = 3;

export interface NodeSwitchReportInput {
  readonly result: NodeSwitchBenchResult;
  readonly machine: MachineInfo;
  readonly commit: string;
  readonly date: string;
  readonly browserVersion: string;
  readonly playwrightVersion: string;
  readonly concurrentWork: string;
}

export interface NodeSwitchReport {
  readonly report: string;
  readonly r_ids: readonly string[];
  readonly machine: MachineInfo;
  readonly commit: string;
  readonly date: string;
  readonly toolchain: string;
  readonly pass: boolean;
  readonly thresholds: Readonly<Record<string, { readonly max: number; readonly unit: string }>>;
  readonly measurements: readonly ReportMeasurement[];
  readonly notes: string;
  readonly renderer: NodeSwitchBenchResult["renderer"];
  readonly switches: number;
  readonly warmup_switches: number;
  readonly concurrent_work: string;
  readonly user_agent: string;
  readonly switch_times_ms: readonly number[];
}

function round(value: number): number {
  const factor = 10 ** DECIMALS;
  return Math.round(value * factor) / factor;
}

export function buildNodeSwitchReport(input: NodeSwitchReportInput): NodeSwitchReport {
  const { result } = input;
  const threshold = { max: NODE_SWITCH_BUDGET_MS, unit: UNIT };
  const pass = result.p95 < NODE_SWITCH_BUDGET_MS;
  return {
    report: NODE_SWITCH_REPORT_ID,
    r_ids: [R_ID],
    machine: input.machine,
    commit: input.commit,
    date: input.date,
    toolchain: `Chromium ${input.browserVersion}, Playwright ${input.playwrightVersion}`,
    pass,
    thresholds: { "switch/p95": threshold },
    measurements: [
      { id: "switch/p95", value: round(result.p95), unit: UNIT, threshold, pass },
      { id: "switch/p50", value: round(result.p50), unit: UNIT },
      { id: "switch/max", value: round(result.max), unit: UNIT },
    ],
    notes: [
      `Renderer: ${result.renderer.string ?? "unavailable"} (${result.renderer.kind}).`,
      `${result.n} recorded node switches after ${result.warmupSwitches} untimed warm-up switches, rotating ${result.nodes} synthetic nodes.`,
      "A switch is the study screen's node-switch metric: from the request to the frame after the matrix and the Overview table rendered; p95 is nearest rank and must be under 50 ms, strictly.",
      `Concurrent heavy work: ${input.concurrentWork}.`,
    ].join(" "),
    renderer: result.renderer,
    switches: result.n,
    warmup_switches: result.warmupSwitches,
    concurrent_work: input.concurrentWork,
    user_agent: result.userAgent,
    switch_times_ms: result.switchesMs.map(round),
  };
}
