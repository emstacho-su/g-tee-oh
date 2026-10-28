/**
 * The study prefetch cache (R3.3): bounded least recently used eviction, a time to live read from
 * an injected clock, frozen entries, and a key that separates solution, node and hands value.
 */
import { describe, expect, it } from "vitest";

import { createNodeCache, nodeCacheKey, PREFETCH_CACHE_ENTRIES, PREFETCH_TTL_MS } from "../src/study/node-cache.js";

interface Entry {
  readonly name: string;
  readonly rows: ReadonlyArray<{ readonly hand: string }>;
}

function entry(name: string): Entry {
  return { name, rows: [{ hand: "AA" }] };
}

function manualClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe("R3.3 study prefetch cache", () => {
  it("R3.3 names its bounds as constants: 256 entries, 60 seconds", () => {
    expect(PREFETCH_CACHE_ENTRIES).toBe(256);
    expect(PREFETCH_TTL_MS).toBe(60_000);
  });

  it("R3.3 evicts the least recently used entry when full", () => {
    const cache = createNodeCache<Entry>({ maxEntries: 2 });
    cache.set("a", entry("a"));
    cache.set("b", entry("b"));
    expect(cache.get("a")?.name).toBe("a");
    cache.set("c", entry("c"));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")?.name).toBe("a");
    expect(cache.get("c")?.name).toBe("c");
    expect(cache.size).toBe(2);
  });

  it("R3.3 an entry older than the time to live is a miss and is dropped", () => {
    const clock = manualClock(1000);
    const cache = createNodeCache<Entry>({ ttlMs: 100, now: clock.now });
    cache.set("a", entry("a"));
    clock.advance(100);
    expect(cache.get("a")?.name).toBe("a");
    clock.advance(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("R3.3 entries are frozen, deeply, so a reader cannot change what the next reader gets", () => {
    const cache = createNodeCache<Entry>();
    cache.set("a", entry("a"));
    const cached = cache.get("a");
    expect(Object.isFrozen(cached)).toBe(true);
    expect(Object.isFrozen(cached?.rows)).toBe(true);
    expect(Object.isFrozen(cached?.rows[0])).toBe(true);
  });

  it("R3.3 setting an existing key replaces it and refreshes its age", () => {
    const clock = manualClock();
    const cache = createNodeCache<Entry>({ ttlMs: 10, now: clock.now });
    cache.set("a", entry("old"));
    clock.advance(8);
    cache.set("a", entry("new"));
    clock.advance(8);
    expect(cache.get("a")?.name).toBe("new");
    expect(cache.size).toBe(1);
  });

  it("R3.3 rejects bounds that are not positive integers", () => {
    expect(() => createNodeCache({ maxEntries: 0 })).toThrow();
    expect(() => createNodeCache({ ttlMs: -1 })).toThrow();
  });

  it("R3.3 the key separates the solution, the node key and the hands value", () => {
    const keys = new Set([
      nodeCacheKey({ solutionId: "s", nodeKey: "k", hands: "class" }),
      nodeCacheKey({ solutionId: "s", nodeKey: "k", hands: "AKs" }),
      nodeCacheKey({ solutionId: "t", nodeKey: "k", hands: "class" }),
      nodeCacheKey({ solutionId: "s", nodeKey: "k2", hands: "class" }),
    ]);
    expect(keys.size).toBe(4);
  });
});
