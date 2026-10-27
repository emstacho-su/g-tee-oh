/**
 * Frame time statistics for the matrix frame bench (S24, R3.12, O-260).
 *
 * Mechanism: the percentiles are nearest rank, the same rule the criterion bench report uses
 * (validation/reports/README.md): sort the times ascending and take the value at rank
 * ceil(q n), counting from 1. No interpolation, so the reported p95 is a frame that happened.
 */
import type { MatrixMode } from "../components/range-matrix/model.js";
import type { ModeFrames } from "./bench-api.js";

const P50 = 0.5;
const P95 = 0.95;

/** The value at rank ceil(q n) of an ascending list; throws on an empty list. */
export function nearestRank(sorted: readonly number[], quantile: number): number {
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  const value = sorted[rank - 1];
  if (value === undefined) throw new RangeError("nearestRank: no frame times to rank");
  return value;
}

export function summarizeFrames(mode: MatrixMode, framesMs: readonly number[]): ModeFrames {
  const sorted = [...framesMs].sort((left, right) => left - right);
  return {
    mode,
    n: sorted.length,
    framesMs: sorted,
    p50: nearestRank(sorted, P50),
    p95: nearestRank(sorted, P95),
    max: nearestRank(sorted, 1),
  };
}
