/**
 * The range drift cache (R3.18, O-304, PR #29 review M9): learning's bootstrap draws 1,000
 * resamples over up to 2,000 decisions synchronously, which measured about 550 to 900 ms per
 * computation at the full caps on the dev machine and blocked the event loop on every GET
 * /insights/drift. The result is a pure function of the user's drift-ready attempts in one spot
 * class, so it is cached and recomputed only when that set changes.
 *
 * Mechanism:
 * - The key is (user id, spot_class_key, newest drift-ready attempt id). Attempt ids are uuidv7
 *   and the api only ever inserts attempt rows (no route updates or deletes one), so a new attempt
 *   in the class changes the newest id and the next read misses and recomputes. A read with no new
 *   attempt hits and runs no bootstrap.
 * - Every read still runs the capped attempt query (filtered by user_id), and the newest id is
 *   taken from the rows that query returned, so a cached value is always stored under the id of
 *   the data it was computed from, even when an attempt lands between two reads.
 * - The user id is part of the key, so one user can never be served another user's entry.
 * - The store is the bounded least recently used cache of study/node-cache.ts (frozen entries,
 *   injected clock). Its time to live only bounds memory and any row edited outside the api; it
 *   never serves numbers older than the newest attempt.
 * - The cache is per app: routes/insights.ts creates one reader in its plugin, never at module
 *   scope, so two apps (two test files) never share entries.
 */
import { rangeDrift, type DriftDecision, type DriftResult } from "@g-tee-oh/learning";

import type { Database } from "../db.js";
import { createNodeCache, type NodeCache } from "../study/node-cache.js";
import { readDriftRows, toDriftDecision, toRangeDrift, type DriftRow, type RangeDrift } from "./drift.js";

/** How many (user, spot class) drift results the cache holds before evicting the least recently used. */
export const DRIFT_CACHE_ENTRIES = 512;
/** How long a cached drift result is served, in milliseconds (10 minutes); new attempts invalidate it sooner. */
export const DRIFT_CACHE_TTL_MS = 600_000;

export type DriftCompute = (decisions: readonly DriftDecision[]) => DriftResult;

export interface DriftReaderOptions {
  cache?: NodeCache<RangeDrift>;
  compute?: DriftCompute;
}

export interface DriftReader {
  read(database: Database, userId: string, spotClassKey: string): Promise<RangeDrift>;
}

/** The cache key of one drift read; JSON keeps the three parts unambiguous whatever they hold. */
export function driftCacheKey(userId: string, spotClassKey: string, newestAttemptId: string | null): string {
  return JSON.stringify([userId, spotClassKey, newestAttemptId]);
}

/** The newest drift-ready attempt's id (readDriftRows orders newest first), or null with none. */
function newestAttemptId(rows: readonly DriftRow[]): string | null {
  return rows[0]?.id ?? null;
}

/** GET /insights/drift's reader: the session user's range drift in one node family, cached (M9). */
export function createDriftReader(options: DriftReaderOptions = {}): DriftReader {
  const cache = options.cache ?? createNodeCache<RangeDrift>({ maxEntries: DRIFT_CACHE_ENTRIES, ttlMs: DRIFT_CACHE_TTL_MS });
  const compute = options.compute ?? rangeDrift;
  return {
    async read(database, userId, spotClassKey) {
      const rows = await readDriftRows(database, userId, spotClassKey);
      const key = driftCacheKey(userId, spotClassKey, newestAttemptId(rows));
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const drift = toRangeDrift(spotClassKey, compute(rows.map(toDriftDecision)));
      cache.set(key, drift);
      return drift;
    },
  };
}
