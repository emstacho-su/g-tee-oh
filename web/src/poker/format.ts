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

/** "Raise 2.5bb", "Call", "All-in 100bb": the exact-size label of a tree action (Standard mode). */
export function exactActionLabel(action: NodeAction): string {
  const name = actionStyle(action.kind).name;
  return action.size_cbb === null ? name : `${name} ${formatCbb(action.size_cbb)}`;
}
