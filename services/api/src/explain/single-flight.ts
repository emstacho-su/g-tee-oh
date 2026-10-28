/**
 * One generation per cache key at a time (R3.20, O-306, PR #29 review L10). Two identical asks
 * (the same question about the same grounding, PM1's cache key) that both miss the cache would
 * otherwise both reserve and both pay. The first to arrive generates; a second that arrives while
 * it runs waits for it and then reads the cache, so it is served the stored answer for nothing.
 *
 * The api is one process per host (http/rate-limits.ts), so an in-process map is enough there; ask.ts
 * also re-reads the cache after its reservation, which closes most of the gap if a second process
 * ever runs. Entries are removed when their generation settles, success or failure.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** The running generation for `key`, if any. */
export function runningFor(key: string): Promise<unknown> | undefined {
  return inFlight.get(key);
}

/** Runs `work` as the generation for `key`; callers check runningFor first. */
export async function runAlone<Result>(key: string, work: () => Promise<Result>): Promise<Result> {
  const running = work();
  inFlight.set(key, running);
  try {
    return await running;
  } finally {
    if (inFlight.get(key) === running) {
      inFlight.delete(key);
    }
  }
}
