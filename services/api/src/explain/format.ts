/**
 * The one formatting spec of the explanation path (R3.19, O-309, A6 section 5, ADR 0004): big
 * blinds with two decimals, percentages with one. No other rounding happens anywhere in the
 * templates, so the validator's rule (a shown number is within half a unit of its last digit of a
 * grounding value, or of 100 times one, O-308) holds for every template by construction.
 *
 * formatPct says at each call whether the value is already in percent as Rust gives it (a loss in
 * percent of the pot, a percentage-point advantage) or is a share from 0 to 1 that is shown as a
 * percentage; that scaling is display only, never a new poker number. A value that rounds to zero
 * is written without a sign, so a tiny negative EV never reads "-0.00".
 */

export const BB_DECIMALS = 2;
export const PCT_DECIMALS = 1;
const PERCENT_PER_SHARE = 100;

/** Where a percentage comes from: a Rust percent value, or a 0 to 1 share shown as a percent. */
export type PercentSource = "percent" | "share";

function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}

/** A big-blind amount with two decimals, no unit. */
export function formatBb(value: number): string {
  return fixed(value, BB_DECIMALS);
}

/** A percentage with one decimal and no percent sign: `source` says whether `value` is a percent or a share. */
export function formatPct(value: number, source: PercentSource): string {
  return fixed(source === "share" ? value * PERCENT_PER_SHARE : value, PCT_DECIMALS);
}
