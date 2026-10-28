/**
 * The class catalog over the fixture solver-query (R4.10, O-270, ADR 0004): classes, families and
 * hero seats come from solver-query, every reach is a probability and every prior learning's; pairs
 * the library does not hold are gaps; a scope naming a configuration the catalog does not serve is a
 * 400; loads are cached per scope with one in flight, and a coverage_added notification drops them.
 */
import { frequencyPriorPer1000 } from "@g-tee-oh/learning";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CATALOG_TTL_MS,
  invalidateClassCatalogs,
  loadClassCatalog,
  watchCoverageAdded,
} from "../src/automated/class-catalog.js";
import type { Database } from "../src/db.js";
import type { NotificationListener, NotificationSource } from "../src/events/source.js";
import { ProblemError } from "../src/http/problem.js";
import { TRACK_KEYS } from "../src/learning/tracks.js";
import { appDatabase } from "./support/database.js";
import { countingFetch, fixtureSolverQuery } from "./support/solver-query.js";

const ONLINE_100 = "cfg_6_online_100";
/** A live configuration the fixture library holds no solution for. */
const LIVE_150 = "cfg_9_live_13_150";
const SIX_MAX_PAIRS = 15;
const NINE_MAX_PAIRS = 36;
const COVERAGE_PATH = "/v1/coverage";

let database: Database;

beforeAll(() => {
  database = appDatabase();
});

afterAll(async () => {
  await database.destroy();
});

beforeEach(() => {
  invalidateClassCatalogs();
});

describe("R4.10 class catalog over the fixture library (O-270)", () => {
  it("R4.10 a covered 6-max configuration lists its classes with solver-query's families, tracks and priors", async () => {
    const catalog = await loadClassCatalog(fixtureSolverQuery(), database, [ONLINE_100]);
    expect(catalog.coveredPairs).toHaveLength(SIX_MAX_PAIRS);
    expect(catalog.uncoveredPairs).toEqual([]);
    expect(catalog.classes.length).toBeGreaterThan(0);
    const families = new Set(catalog.classes.map((cls) => cls.family));
    expect(families).toContain("rfi");
    expect(families).toContain("facing-open");
    for (const cls of catalog.classes) {
      expect(cls.options.length).toBeGreaterThan(0);
      expect(cls.format).toBe("online");
      expect(cls.depthBand.length).toBeGreaterThan(0);
      for (const option of cls.options) {
        expect(option.lineReach).toBeGreaterThan(0);
        expect(option.lineReach).toBeLessThanOrEqual(1 + 1e-6);
        expect(option.spots.length).toBeGreaterThan(0);
      }
      const expected = cls.options
        .map((option) => frequencyPriorPer1000(option.tableSize, Math.min(option.lineReach, 1)))
        .reduce((sum, prior, _, all) => sum + prior / all.length, 0);
      expect(cls.frequencyPriorPer1k).toBeCloseTo(expected, 8);
      expect(cls.trackKey === null || TRACK_KEYS.includes(cls.trackKey)).toBe(true);
    }
    expect(catalog.byKey.size).toBe(catalog.classes.length);
  });

  it("R4.10 a configuration the library does not hold is all gaps and no classes", async () => {
    const catalog = await loadClassCatalog(fixtureSolverQuery(), database, [LIVE_150]);
    expect(catalog.classes).toEqual([]);
    expect(catalog.coveredPairs).toEqual([]);
    expect(catalog.uncoveredPairs).toHaveLength(NINE_MAX_PAIRS);
  });

  it("R4.10 a scope naming a configuration the catalog does not serve is a 400", async () => {
    await expect(loadClassCatalog(fixtureSolverQuery(), database, ["cfg_2_online_norake_10"])).rejects.toMatchObject({ status: 400 });
    await expect(loadClassCatalog(fixtureSolverQuery(), database, ["cfg_2_online_norake_10"])).rejects.toBeInstanceOf(ProblemError);
  });

  it("R4.10 loads are cached per scope with one in flight, expire after the TTL, and drop on coverage_added", async () => {
    const counting = countingFetch();
    const client = fixtureSolverQuery(counting.fetch);
    let clock = 0;
    const nowMs = () => clock;
    const [first, second] = await Promise.all([
      loadClassCatalog(client, database, [ONLINE_100], { nowMs }),
      loadClassCatalog(client, database, [ONLINE_100], { nowMs }),
    ]);
    expect(second).toBe(first);
    const calls = () => counting.calls.filter((path) => path === COVERAGE_PATH).length;
    expect(calls()).toBe(SIX_MAX_PAIRS);
    clock = CATALOG_TTL_MS - 1;
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(SIX_MAX_PAIRS);
    clock = CATALOG_TTL_MS;
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(2 * SIX_MAX_PAIRS);

    let listener: NotificationListener = () => undefined;
    const source: NotificationSource = {
      subscribe: (added) => {
        listener = added;
        return () => undefined;
      },
      close: () => Promise.resolve(),
    };
    watchCoverageAdded(source);
    listener("builder_state", "{}");
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(2 * SIX_MAX_PAIRS);
    listener("coverage_added", "{}");
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(3 * SIX_MAX_PAIRS);
  });
});
