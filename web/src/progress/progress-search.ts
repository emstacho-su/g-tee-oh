/**
 * The /progress address (S47 follow-up, R4.19): the leak trend's weeks and the frequency card's
 * chosen spot, so a reload, a copied link or Back to the page shows the same view. Both are
 * written with replace, so choosing never adds a history entry.
 *
 * The search is untrusted input: weeks must be one of the trend's offered spans (a number, or its
 * digits as text), and spot must have the shape of a spotKey: a solution uuid, "|", then a node key
 * the api's nodeKeySchema would take (1 to 512 characters of any kind, services/api/src/schemas/common.ts;
 * PR 51 review round 2: a stricter shape here dropped a chosen spot the api serves). Anything else
 * is dropped and the page falls back to its defaults: the default weeks and the first spot the
 * api lists.
 */
import { LEAK_WEEK_OPTIONS, type LeakWeeks } from "./types.js";

export interface ProgressSearch {
  readonly weeks?: LeakWeeks;
  readonly spot?: string;
}

/** The api's MAX_NODE_KEY_LENGTH (schemas/common.ts), in UTF-16 units as zod's max counts them. */
const MAX_NODE_KEY_LENGTH = 512;
const SPOT_SEPARATOR = "|";
const SOLUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function weeksOf(value: unknown): LeakWeeks | undefined {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  return LEAK_WEEK_OPTIONS.find((option) => option === number);
}

function spotOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const separator = value.indexOf(SPOT_SEPARATOR);
  if (separator < 0) return undefined;
  const solutionId = value.slice(0, separator);
  const nodeKey = value.slice(separator + SPOT_SEPARATOR.length);
  return SOLUTION_ID_PATTERN.test(solutionId) && nodeKey.length >= 1 && nodeKey.length <= MAX_NODE_KEY_LENGTH ? value : undefined;
}

export function validateProgressSearch(search: Record<string, unknown>): ProgressSearch {
  const weeks = weeksOf(search["weeks"]);
  const spot = spotOf(search["spot"]);
  return { ...(weeks === undefined ? {} : { weeks }), ...(spot === undefined ? {} : { spot }) };
}
