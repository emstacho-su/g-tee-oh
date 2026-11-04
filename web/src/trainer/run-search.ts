/**
 * The /drills/$id/run search parameters (S25, R3.13, O-288; S47, R3.36, O-484). An optional seed
 * of 16 hex digits (the contract's Hex64) is passed to POST /sessions, so a session can be
 * replayed and flow 4 is deterministic (O-249 allows any client to send one). An optional
 * start=1 is the autostart flag a drill row's Start or the builder's Save and run carries: the run
 * screen consumes it once after reading the drill and drops it from the address, so a reload or
 * Back never starts another session. Anything else is dropped.
 */
export interface DrillRunSearch {
  seed?: string;
  start?: typeof AUTOSTART_FLAG;
}

const SEED_PATTERN = /^[0-9a-f]{16}$/;
export const AUTOSTART_FLAG = "1";

export function validateDrillRunSearch(search: Record<string, unknown>): DrillRunSearch {
  const seed = search["seed"];
  const start = search["start"];
  return {
    ...(typeof seed === "string" && SEED_PATTERN.test(seed) ? { seed } : {}),
    ...(start === AUTOSTART_FLAG ? { start: AUTOSTART_FLAG } : {}),
  };
}
