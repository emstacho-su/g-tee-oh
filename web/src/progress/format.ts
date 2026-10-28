/**
 * Text for progress figures (S32, R4.12, O-8). Ratings show as whole points, deviations as
 * "plus or minus" whole points, scores as percents, leak costs in bb per 1,000 hands to one
 * decimal. Tier names are the placeholders O-8 fixed (Tier I to VIII). Dates are formatted in UTC
 * from the api's ISO strings, so a test's output never depends on the machine's time zone.
 */
import type { Tier, TrackKey } from "./types.js";

export const RATING_DECIMALS = 0;
export const LEAK_DECIMALS = 1;
export const PERCENT_SCALE = 100;

export function tierLabel(tier: Tier): string {
  return `Tier ${tier}`;
}

export function formatRating(value: number): string {
  return value.toFixed(RATING_DECIMALS);
}

/** "± 74", read by screen readers as "plus or minus 74". */
export function formatDeviation(rd: number): string {
  return `± ${rd.toFixed(RATING_DECIMALS)}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * PERCENT_SCALE)}%`;
}

export function formatLeak(bbPer1k: number): string {
  return bbPer1k.toFixed(LEAK_DECIMALS);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Oct 26" from "2026-10-26" or an RFC 3339 timestamp; the input is returned when it is not a date. */
export function formatShortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? iso : `${month} ${Number(match[3])}`;
}

/** "October 2026" from a round's first day. */
export function formatMonth(iso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (match === null) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** A track's name from the tracks read, else its key (the tracks read may still be loading). */
export function trackName(key: TrackKey, names: Readonly<Partial<Record<TrackKey, string>>> | undefined): string {
  return names?.[key] ?? key;
}
