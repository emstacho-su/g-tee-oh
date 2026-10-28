/**
 * The drill and seed parameters /quiz and /paint share (S27, S41, R3.16, R3.17, O-302, O-419): drill
 * names the user's drill for an old drill-backed link (a UUID, the contract's drill id) and an
 * optional seed of 16 hex digits (the contract's Hex64) is passed to POST /sessions so a session
 * replays. Anything else is dropped here; quiz-search.ts and paint-search.ts add their own choices,
 * and the route components pass the screens only what those return (the router merges parent
 * search into children, O-286). The /predict redirect keeps exactly these two.
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
