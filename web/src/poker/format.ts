/**
 * Number formatting for the web (S24). Amounts on the wire are integer centi-big-blinds (cbb,
 * hundredths of a big blind: size_cbb, pot_cbb, stacks_cbb), and losses arrive in big blinds and
 * in percent of the pot at the node (O-22). These helpers only format what the api sends; they
 * never recompute a loss or a frequency (ADR 0004).
 */
import type { NodeAction } from "../contracts.js";
import { actionStyle } from "../theme/action-style.js";

const CBB_PER_BB = 100;
const PERCENT = 100;

/** 250 cbb prints as "2.5bb", 10000 as "100bb"; at most two decimals, trailing zeros dropped. */
export function formatCbb(cbb: number): string {
  return `${formatNumber(cbb / CBB_PER_BB, 2)}bb`;
}

/** A big-blind amount with a fixed number of decimals: formatBb(0.1234) is "0.12bb". */
export function formatBb(bb: number, decimals = 2): string {
  return `${bb.toFixed(decimals)}bb`;
}

/** A share in 0..1 as a percent: formatShare(0.4567) is "45.7%". */
export function formatShare(share: number, decimals = 1): string {
  return `${(share * PERCENT).toFixed(decimals)}%`;
}

/**
 * A share in 0..1 rounded to a whole percent (S40, PR #42 review round 1 I): the one rounding for
 * every share the web shows as a whole percent, so a wording chosen from the number and the number
 * printed beside it never disagree. wholePercent(0.996) is 100.
 */
export function wholePercent(share: number): number {
  return Math.round(share * PERCENT);
}

/** A share as a whole percent: formatWholePercent(0.613) is "61%". */
export function formatWholePercent(share: number): string {
  return `${wholePercent(share)}%`;
}

/** A reach-weighted combo count as whole combos with a thousands separator: formatCombos(503.9) is "504 combos" (S45, O-469). */
export function formatCombos(combos: number): string {
  const whole = Math.round(combos);
  return `${whole.toLocaleString("en-US")} ${whole === 1 ? "combo" : "combos"}`;
}

/** A value already in percent: formatPercent(1.25) is "1.25%". */
export function formatPercent(percent: number, decimals = 2): string {
  return `${percent.toFixed(decimals)}%`;
}

const BASIS_POINTS_PER_PERCENT = 100;
const CENTS_PER_DOLLAR = 100;

/**
 * A stored rake rate in basis points as a percent: formatBasisPoints(500) is "5%", 450 is "4.5%".
 * Display only; no rake is computed in TypeScript (ADR 0004).
 */
export function formatBasisPoints(basisPoints: number): string {
  return `${formatNumber(basisPoints / BASIS_POINTS_PER_PERCENT, 2)}%`;
}

/** A stored amount in cents as dollars: formatCents(150) is "$1.50". Display only. */
export function formatCents(cents: number): string {
  return `$${(cents / CENTS_PER_DOLLAR).toFixed(2)}`;
}

function formatNumber(value: number, maxDecimals: number): string {
  return Number(value.toFixed(maxDecimals)).toString();
}

/**
 * "Raise to 2.5bb", "Call", "All-in 100bb": the exact-size label of a tree action (Standard mode). A raise
 * names the total it raises to, the one form the api's own label uses (S45, screen critic: one name per
 * action on a screen), so a legend naming the api label and a table naming this agree.
 */
export function exactActionLabel(action: NodeAction): string {
  return sizedActionLabel(action.kind, action.size_cbb);
}

/** The label of an action kind at a size in cbb (null for an unsized kind); shared with tokenActionLabel. */
export function sizedActionLabel(kind: NodeAction["kind"], sizeCbb: number | null): string {
  const name = actionStyle(kind).name;
  if (sizeCbb === null) return name;
  return kind === "raise" ? `${name} to ${formatCbb(sizeCbb)}` : `${name} ${formatCbb(sizeCbb)}`;
}
