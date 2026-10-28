/**
 * The study prefetch cache (R3.3, S23 plan decision 6): a bounded, in-process cache of nodes read
 * from solver-query, so the node the api prefetched in the background is served on the next
 * request without another solver-query read.
 *
 * Mechanism: a Map keeps insertion order, so the first key is the least recently used one; a get
 * that hits moves its key to the end, and a set past the bound evicts from the front. Each entry
 * records when it was stored and is a miss (and dropped) once older than the time to live, read
 * from an injected clock so tests need no timers. Library solutions are immutable once published
 * (ADR 0018), so a short time to live only bounds memory, never staleness of numbers. Entries are
 * deeply frozen on the way in, so one reader can never change what the next reader gets. Only
 * successful reads are ever set; a failed read leaves nothing behind (node-reader.ts).
 *
 * The cache is per app: routes/study.ts creates one in its plugin, never at module scope, so two
 * apps (two test files) never share entries.
 */

/** How many nodes the cache holds before it evicts the least recently used one. */
export const PREFETCH_CACHE_ENTRIES = 256;
/** How long a cached node is served, in milliseconds. */
export const PREFETCH_TTL_MS = 60_000;

export type Clock = () => number;

export interface NodeCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: Clock;
}

export interface NodeCache<Value> {
  get(key: string): Readonly<Value> | undefined;
  set(key: string, value: Value): void;
  readonly size: number;
}

/** What identifies one node read: the solution, the node key and solver-query's hands value. */
export interface NodeCacheKeyParts {
  solutionId: string;
  nodeKey: string;
  hands: string;
}

interface StoredEntry<Value> {
  value: Readonly<Value>;
  storedAt: number;
}

/** The cache key of one node read; JSON keeps the three parts unambiguous whatever they hold. */
export function nodeCacheKey(parts: NodeCacheKeyParts): string {
  return JSON.stringify([parts.solutionId, parts.nodeKey, parts.hands]);
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

export function createNodeCache<Value>(options: NodeCacheOptions = {}): NodeCache<Value> {
  const maxEntries = requirePositiveInteger("maxEntries", options.maxEntries ?? PREFETCH_CACHE_ENTRIES);
  const ttlMs = requirePositiveInteger("ttlMs", options.ttlMs ?? PREFETCH_TTL_MS);
  const now = options.now ?? Date.now;
  const entries = new Map<string, StoredEntry<Value>>();

  function evictOverflow(): void {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) {
        return;
      }
      entries.delete(oldest.value);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        return undefined;
      }
      entries.delete(key);
      if (now() - entry.storedAt > ttlMs) {
        return undefined;
      }
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value: deepFreeze(value), storedAt: now() });
      evictOverflow();
    },
    get size() {
      return entries.size;
    },
  };
}
