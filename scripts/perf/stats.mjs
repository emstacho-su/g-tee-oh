// Percentiles for just perf (R3.3, O-40). Nearest rank, as bench-report.mjs takes p95_ns and the
// matrix frame bench takes its p95: the value at rank ceil(p n) of the samples sorted ascending,
// so the reported number is always one measured sample, never an interpolation.

import { PerfError } from "./errors.mjs";

export const P50_FRACTION = 0.5;
export const P95_FRACTION = 0.95;
const MIN_RANK = 1;

/** The nearest-rank percentile of `values` at `fraction` (0 < fraction <= 1); the input is not sorted in place. */
export function nearestRankPercentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new PerfError("no sample to take a percentile of");
  }
  if (typeof fraction !== "number" || !(fraction > 0 && fraction <= 1)) {
    throw new PerfError(`percentile fraction ${String(fraction)} is not in (0, 1]`);
  }
  const bad = values.findIndex((value) => typeof value !== "number" || !Number.isFinite(value));
  if (bad !== -1) {
    throw new PerfError(`sample ${bad} is not a finite number: ${JSON.stringify(values[bad])}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(MIN_RANK, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

/** The median, the p95, the maximum and the count of one path's samples. */
export function summarize(values) {
  return {
    p50: nearestRankPercentile(values, P50_FRACTION),
    p95: nearestRankPercentile(values, P95_FRACTION),
    max: nearestRankPercentile(values, 1),
    samples: values.length,
  };
}
