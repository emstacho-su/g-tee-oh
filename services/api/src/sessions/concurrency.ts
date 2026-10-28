/**
 * Bounded fan-out of solver-query calls (R3.6, PR #25 review MEDIUM 3): a drill can expand into
 * dozens of (configuration, pair) candidates, and POST /sessions asks solver-query about each.
 * mapBounded runs at most `limit` calls at once, so one request never floods solver-query, and
 * returns the results in input order. The first rejection rejects the whole map; calls already
 * started finish, and no new one starts after it.
 */

/** The most solver-query calls one api request keeps in flight (PR #25 review MEDIUM 3). */
export const MAX_CONCURRENT_SOLVER_CALLS = 8;

/** Maps `items` through `fn`, `limit` at a time, keeping the input order. */
export function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`a concurrency limit must be a positive integer, not ${limit}`);
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  return Promise.all(workers).then(() => results);
}
