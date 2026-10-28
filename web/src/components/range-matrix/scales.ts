/**
 * The range matrix's expected value (EV) and range weight steps (S38, R3.12, O-384, O-385). Pure.
 *
 * Mechanism: both scales are quantized, so a frame picks colours from fixed arrays by step and
 * allocates no colour strings (the 16 ms frame budget, O-260). EV is diverging: a best EV within
 * EV_NEUTRAL_BB of zero is step 0, the clear neutral middle (preflop folds are exactly 0); beyond
 * it the step is the share of the scale end in fifths, signed, 1 to 5 on each side, and past the
 * end the end step holds. The scale end is the model's evScaleBb (model.ts: the 90th percentile of
 * the absolute best EV, at least MIN_EV_SCALE_BB), so one huge hand does not wash out the rest.
 * Weight is single-hue: 0 is step 0 (the plain ground), an unknown weight is null (the missing
 * hatch), and quintiles are steps 1 to 5. The legends name each step's range in words; the canvas
 * still prints every number, so colour is never the only signal (A7 section 4). These are display
 * rules only; nothing is recomputed from the api's numbers (ADR 0004).
 */
export const EV_STEPS = 5;
/** Best EVs closer to zero than this read as neutral (O-384). */
export const EV_NEUTRAL_BB = 0.05;
/** The percentile of the absolute best EV that ends the scale (O-384). */
export const EV_SCALE_PERCENTILE = 0.9;
/** The smallest scale end, so a node of near-zero EVs is not painted at full strength. */
export const MIN_EV_SCALE_BB = 0.5;
export const WEIGHT_STEPS = 5;

const PERCENT = 100;
const BOUNDARY_DECIMALS = 2;
const SHORT_DECIMALS = 1;

/** The signed step of a best EV: 0 in the neutral band, 1 to 5 positive, -1 to -5 negative. */
export function evStep(evBb: number, scaleBb: number): number {
  const size = Math.abs(evBb);
  if (!(size >= EV_NEUTRAL_BB)) return 0;
  const share = Math.min(1, size / scaleBb);
  const step = Math.min(EV_STEPS, Math.max(1, Math.ceil(share * EV_STEPS)));
  return evBb > 0 ? step : -step;
}

/** The weight step: null when unknown, 0 for none, 1 to 5 by quintile (above 1 holds at 5). */
export function weightStep(weight: number | null): number | null {
  if (weight === null) return null;
  if (!(weight > 0)) return 0;
  return Math.min(WEIGHT_STEPS, Math.max(1, Math.ceil(weight * WEIGHT_STEPS)));
}

/**
 * The value at quantile q of the values by the nearest-rank method (the sorted value at rank
 * ceil(q n)), or null for an empty list. Sorts a copy.
 */
export function nearestRank(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

export interface LegendStep {
  /** The signed EV step (-5 to 5) or the weight step (0 to 5). */
  readonly step: number;
  /** The tick printed under the swatch. */
  readonly short: string;
  /** The step's whole range in words, for the list item's text. */
  readonly long: string;
}

/** A boundary in bb with at most two decimals and no trailing zeros: 0.4, 0.05, 2. */
function boundary(bb: number): string {
  return String(Number(bb.toFixed(BOUNDARY_DECIMALS)));
}

function evSideStep(step: number, scaleBb: number): LegendStep {
  const size = Math.abs(step);
  const sign = step > 0 ? "+" : "-";
  const lower = size === 1 ? EV_NEUTRAL_BB : ((size - 1) * scaleBb) / EV_STEPS;
  const upper = (size * scaleBb) / EV_STEPS;
  const short = `${sign}${upper.toFixed(SHORT_DECIMALS)}`;
  if (size === EV_STEPS) {
    const beyond = step > 0 ? "more than" : "less than";
    return { step, short, long: `${beyond} ${sign}${boundary(lower)}bb` };
  }
  return { step, short, long: `${sign}${boundary(lower)}bb to ${sign}${boundary(upper)}bb` };
}

/** The eleven EV steps from -5 to 5 with their ranges for a scale end in bb. */
export function evLegend(scaleBb: number): readonly LegendStep[] {
  return Array.from({ length: 2 * EV_STEPS + 1 }, (_, index) => {
    const step = index - EV_STEPS;
    if (step === 0) return { step, short: "near 0", long: `near 0: within ${EV_NEUTRAL_BB}bb either way` };
    return evSideStep(step, scaleBb);
  });
}

/** The six weight steps from the empty ground to 100 percent. */
export function weightLegend(): readonly LegendStep[] {
  const width = PERCENT / WEIGHT_STEPS;
  return Array.from({ length: WEIGHT_STEPS + 1 }, (_, step) => {
    if (step === 0) return { step, short: "0%", long: "0%: not in the range" };
    return { step, short: `${step * width}%`, long: `${(step - 1) * width + 1}% to ${step * width}%` };
  });
}
