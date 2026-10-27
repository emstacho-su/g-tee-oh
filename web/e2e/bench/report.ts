/**
 * Builds the matrix frame report from a bench run (S24, R3.12, O-260).
 *
 * Mechanism: a pure function from the page's MatrixBenchResult plus the machine, commit, date,
 * browser and Playwright versions to the JSON envelope of validation/reports/report.schema.json
 * (report "matrix-frame", r_ids R3.12). Each mode gives three measurements: p95 (judged, strictly
 * under 16 ms, A7 section 4), p50 and max (informational, no pass field). pass is true only when
 * every mode's p95 is under 16 ms, so the report's verdict agrees with its judged measurements
 * as scripts/check-reports.mjs requires. The renderer, the device pixel ratio, the frame counts
 * and the concurrent heavy work go in notes and in documented top-level fields, and every
 * recorded frame time is kept so a reader can recompute the percentiles. The environment
 * parsers reject a bad BENCH_MACHINE or BENCH_FRAMES instead of writing a mislabeled report.
 */
import type { MatrixBenchResult } from "../../src/bench/bench-api.js";

export const FRAME_BUDGET_MS = 16;
export const DEFAULT_MACHINE = "zenbook";
export const DEFAULT_FRAMES = 600;
export const REPORT_ID = "matrix-frame";
const R_ID = "R3.12";
const UNIT = "ms";
const MACHINE_PATTERN = /^[a-z][a-z0-9-]*$/;
const FRAME_DECIMALS = 3;

export interface MachineInfo {
  readonly name: string;
  readonly os: string;
  readonly cpu: string;
  readonly cores: number;
  readonly memory_gb: number;
}

export interface ReportInput {
  readonly result: MatrixBenchResult;
  readonly machine: MachineInfo;
  readonly commit: string;
  readonly date: string;
  readonly browserVersion: string;
  readonly playwrightVersion: string;
  readonly concurrentWork: string;
}

export interface ReportMeasurement {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
  readonly threshold?: { readonly max: number; readonly unit: string };
  readonly pass?: boolean;
}

export interface MatrixFrameReport {
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
  readonly renderer: MatrixBenchResult["renderer"];
  readonly pixel_ratio: number;
  readonly size_px: number;
  readonly frames_per_mode: number;
  readonly warmup_frames_per_mode: number;
  readonly concurrent_work: string;
  readonly user_agent: string;
  readonly frame_times_ms: Readonly<Record<string, readonly number[]>>;
}

/** BENCH_MACHINE, or zenbook; must fit the schema's machine name pattern. */
export function parseMachineName(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return DEFAULT_MACHINE;
  if (!MACHINE_PATTERN.test(value)) {
    throw new RangeError(`BENCH_MACHINE must match ${MACHINE_PATTERN.source}, got "${value}"`);
  }
  return value;
}

/** BENCH_FRAMES, or 600; a positive integer. */
export function parseFrameCount(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_FRAMES;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`BENCH_FRAMES must be a positive integer, got "${value}"`);
  return count;
}

function round(value: number): number {
  const factor = 10 ** FRAME_DECIMALS;
  return Math.round(value * factor) / factor;
}

function modeMeasurements(result: MatrixBenchResult): ReportMeasurement[] {
  const threshold = { max: FRAME_BUDGET_MS, unit: UNIT };
  return result.modes.flatMap((mode) => [
    { id: `${mode.mode}/p95`, value: round(mode.p95), unit: UNIT, threshold, pass: mode.p95 < FRAME_BUDGET_MS },
    { id: `${mode.mode}/p50`, value: round(mode.p50), unit: UNIT },
    { id: `${mode.mode}/max`, value: round(mode.max), unit: UNIT },
  ]);
}

function notesFor(input: ReportInput): string {
  const { result } = input;
  return [
    `Renderer: ${result.renderer.string ?? "unavailable"} (${result.renderer.kind}).`,
    `Device pixel ratio ${result.pixelRatio} forced: a ${result.sizePx * result.pixelRatio} pixel backing store for the ${result.sizePx} pixel matrix.`,
    `${result.frames} recorded frames per mode after ${result.warmupFrames} untimed warm-up frames, rotating ${result.variants} synthetic nodes.`,
    "Frame time: model build, full draw and a one-pixel getImageData flush, paced by requestAnimationFrame; p95 is nearest rank and must be under 16 ms, strictly.",
    `Concurrent heavy work: ${input.concurrentWork}.`,
  ].join(" ");
}

export function buildMatrixFrameReport(input: ReportInput): MatrixFrameReport {
  const { result } = input;
  const measurements = modeMeasurements(result);
  const judged = measurements.filter((entry) => entry.pass !== undefined);
  return {
    report: REPORT_ID,
    r_ids: [R_ID],
    machine: input.machine,
    commit: input.commit,
    date: input.date,
    toolchain: `Chromium ${input.browserVersion}, Playwright ${input.playwrightVersion}`,
    pass: judged.every((entry) => entry.pass === true),
    thresholds: Object.fromEntries(result.modes.map((mode) => [`${mode.mode}/p95`, { max: FRAME_BUDGET_MS, unit: UNIT }])),
    measurements,
    notes: notesFor(input),
    renderer: result.renderer,
    pixel_ratio: result.pixelRatio,
    size_px: result.sizePx,
    frames_per_mode: result.frames,
    warmup_frames_per_mode: result.warmupFrames,
    concurrent_work: input.concurrentWork,
    user_agent: result.userAgent,
    frame_times_ms: Object.fromEntries(result.modes.map((mode) => [mode.mode, mode.framesMs.map(round)])),
  };
}
