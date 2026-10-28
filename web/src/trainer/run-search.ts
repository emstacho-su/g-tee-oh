/**
 * The /drills/$id/run search parameters (S25, R3.13, O-288). An optional seed of 16 hex digits
 * (the contract's Hex64) is passed to POST /sessions, so a session can be replayed and flow 4 is
 * deterministic (O-249 allows any client to send one). Anything else is dropped.
 */
export interface DrillRunSearch {
  seed?: string;
}

const SEED_PATTERN = /^[0-9a-f]{16}$/;

export function validateDrillRunSearch(search: Record<string, unknown>): DrillRunSearch {
  const seed = search["seed"];
  return typeof seed === "string" && SEED_PATTERN.test(seed) ? { seed } : {};
}
