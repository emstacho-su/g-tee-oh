/**
 * The /progress address (S47 follow-up, R4.19): the leak trend's weeks and the frequency card's
 * chosen spot, so a reload, a copied link or Back to the page shows the same view. Both are
 * written with replace, so choosing never adds a history entry.
 *
 * The search is untrusted input: weeks must be one of the trend's offered spans (a number, or its
 * digits as text), and spot must have the shape of a spotKey (a solution uuid, "|", then a node key
 * of printable characters, bounded in length). Anything else is dropped and the page falls back to
 * its defaults: the default weeks and the first spot the api lists.
 */
import { LEAK_WEEK_OPTIONS, type LeakWeeks } from "./types.js";

export interface ProgressSearch {
  readonly weeks?: LeakWeeks;
  readonly spot?: string;
}

const MAX_SPOT_KEY_LENGTH = 512;
const SPOT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[!-~]*$/;

function weeksOf(value: unknown): LeakWeeks | undefined {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  return LEAK_WEEK_OPTIONS.find((option) => option === number);
}

function spotOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_SPOT_KEY_LENGTH && SPOT_KEY_PATTERN.test(value) ? value : undefined;
}

export function validateProgressSearch(search: Record<string, unknown>): ProgressSearch {
  const weeks = weeksOf(search["weeks"]);
  const spot = spotOf(search["spot"]);
  return { ...(weeks === undefined ? {} : { weeks }), ...(spot === undefined ? {} : { spot }) };
}
