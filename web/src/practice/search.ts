/**
 * The /predict and /paint search parameters (S27, R3.16, R3.17, O-302). Both screens run a
 * drill-backed practice session: drill names the user's drill (a UUID, the contract's drill id) and
 * an optional seed of 16 hex digits (the contract's Hex64) is passed to POST /sessions so a session
 * replays. Anything else is dropped; the route components pass the screens only what this returns
 * (the router merges parent search into children, O-286).
 */
export interface PracticeSearch {
  drill?: string;
  seed?: string;
}

const SEED_PATTERN = /^[0-9a-f]{16}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

export function validatePracticeSearch(search: Record<string, unknown>): PracticeSearch {
  const drill = matching(search["drill"], UUID_PATTERN);
  const seed = matching(search["seed"], SEED_PATTERN);
  return { ...(drill === undefined ? {} : { drill }), ...(seed === undefined ? {} : { seed }) };
}
