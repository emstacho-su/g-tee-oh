/**
 * The class catalog over the fixture solver-query (R4.10, O-270, ADR 0004): classes, families and
 * hero seats come from solver-query, every reach is a probability and every prior learning's; pairs
 * the library does not hold are gaps; a scope naming a configuration the catalog does not serve is a
 * 400; every scope is cut from one all-configs load (one in flight), a failed or partial load is
 * never cached, an empty one only for EMPTY_CATALOG_TTL_MS (PR #27 review, PM decision), buildApp
 * subscribes the invalidation, and a coverage_added notification drops the cache (PR #27 review
 * HIGH 3, MEDIUM 6, 7, 8).
 */
import { frequencyPriorPer1000 } from "@g-tee-oh/learning";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CATALOG_TTL_MS,
  EMPTY_CATALOG_TTL_MS,
  invalidateClassCatalogs,
  loadClassCatalog,
  watchCoverageAdded,
} from "../src/automated/class-catalog.js";
import type { Database } from "../src/db.js";
import type { NotificationListener, NotificationSource } from "../src/events/source.js";
import { ProblemError } from "../src/http/problem.js";
import { TRACK_KEYS } from "../src/learning/tracks.js";
import { buildApp } from "../src/app.js";
import { COVERAGE_PATH, coverageControl, fullCatalogPairs } from "./R4.10-automated-kit.js";
import { TEST_CONFIG } from "./support/app.js";
import { appDatabase } from "./support/database.js";
import { countingFetch, fixtureSolverQuery } from "./support/solver-query.js";

const ONLINE_100 = "cfg_6_online_100";
/** A live configuration the fixture library holds no solution for. */
const LIVE_150 = "cfg_9_live_13_150";
const SIX_MAX_PAIRS = 15;
const NINE_MAX_PAIRS = 36;
/** A cold all-configs load is hundreds of coverage calls, slow under a parallel suite (MEDIUM 6). */
const COLD_CATALOG_TEST_TIMEOUT_MS = 120_000;

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

describe("R4.10 class catalog over the fixture library (O-270)", { timeout: COLD_CATALOG_TEST_TIMEOUT_MS }, () => {
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

  it("R4.10 loads share one all-configs entry with one in flight, expire after the TTL, and drop on coverage_added (PR #27 review MEDIUM 6)", async () => {
    const counting = countingFetch();
    const client = fixtureSolverQuery(counting.fetch);
    const full = await fullCatalogPairs(database);
    let clock = 0;
    const nowMs = () => clock;
    const [first, second] = await Promise.all([
      loadClassCatalog(client, database, [ONLINE_100], { nowMs }),
      loadClassCatalog(client, database, [ONLINE_100], { nowMs }),
    ]);
    expect(second).toBe(first);
    const calls = () => counting.calls.filter((path) => path === COVERAGE_PATH).length;
    expect(calls()).toBe(full);
    clock = CATALOG_TTL_MS - 1;
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(full);
    clock = CATALOG_TTL_MS;
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(2 * full);

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
    expect(calls()).toBe(2 * full);
    listener("coverage_added", "{}");
    await loadClassCatalog(client, database, [ONLINE_100], { nowMs });
    expect(calls()).toBe(3 * full);
  });

  it("R4.10 every scope is cut from the one all-configs load, so a new config_ids subset walks nothing (PR #27 review MEDIUM 6)", async () => {
    const control = coverageControl();
    const client = fixtureSolverQuery(control.fetch);
    const full = await fullCatalogPairs(database);
    const all = await loadClassCatalog(client, database);
    expect(control.calls()).toBe(full);
    const online = await loadClassCatalog(client, database, [ONLINE_100]);
    const live = await loadClassCatalog(client, database, [LIVE_150]);
    const both = await loadClassCatalog(client, database, [LIVE_150, ONLINE_100]);
    expect(control.calls()).toBe(full);
    expect(online.coveredPairs).toHaveLength(SIX_MAX_PAIRS);
    expect(online.uncoveredPairs).toEqual([]);
    expect(online.classes.flatMap((cls) => cls.options).every((option) => option.configId === ONLINE_100)).toBe(true);
    expect(live.classes).toEqual([]);
    expect(live.uncoveredPairs).toHaveLength(NINE_MAX_PAIRS);
    expect(both.uncoveredPairs).toHaveLength(NINE_MAX_PAIRS);
    expect(both.classes.map((cls) => cls.spotClassKey)).toEqual(online.classes.map((cls) => cls.spotClassKey));
    expect(all.classes.length).toBeGreaterThanOrEqual(online.classes.length);
    expect(await loadClassCatalog(client, database, [ONLINE_100])).toBe(online);
  });

  it("R4.10 a coverage answer whose database did not answer fails the load and is never cached (PR #27 review MEDIUM 7)", async () => {
    const control = coverageControl();
    const client = fixtureSolverQuery(control.fetch);
    const full = await fullCatalogPairs(database);
    control.rewrite = (body) => (body.pair === "BB-BTN" ? { ...body, database: "unavailable", spot_classes: [] } : body);
    await expect(loadClassCatalog(client, database, [ONLINE_100])).rejects.toBeInstanceOf(ProblemError);
    const afterFailure = control.calls();
    control.rewrite = null;
    const catalog = await loadClassCatalog(client, database, [ONLINE_100]);
    expect(control.calls()).toBe(afterFailure + full);
    expect(catalog.coveredPairs).toHaveLength(SIX_MAX_PAIRS);
  });

  it("R4.10 an empty successful catalog is served from cache for EMPTY_CATALOG_TTL_MS, then read again (PR #27 review, PM decision)", async () => {
    const control = coverageControl();
    const client = fixtureSolverQuery(control.fetch);
    const full = await fullCatalogPairs(database);
    let clock = 0;
    const nowMs = () => clock;
    expect(EMPTY_CATALOG_TTL_MS).toBe(30_000);
    control.rewrite = (body) => ({ ...body, spot_classes: [] });
    expect((await loadClassCatalog(client, database, undefined, { nowMs })).classes).toEqual([]);
    expect(control.calls()).toBe(full);
    clock = EMPTY_CATALOG_TTL_MS - 1;
    expect((await loadClassCatalog(client, database, undefined, { nowMs })).classes).toEqual([]);
    expect(control.calls()).toBe(full);
    control.rewrite = null;
    clock = EMPTY_CATALOG_TTL_MS;
    expect((await loadClassCatalog(client, database, undefined, { nowMs })).classes.length).toBeGreaterThan(0);
    expect(control.calls()).toBe(2 * full);
    clock = EMPTY_CATALOG_TTL_MS + CATALOG_TTL_MS - 1;
    await loadClassCatalog(client, database, undefined, { nowMs });
    expect(control.calls()).toBe(2 * full);
  });

  it("R4.10 a coverage_added notification clears a cached empty catalog at once (PR #27 review, PM decision)", async () => {
    const control = coverageControl();
    const client = fixtureSolverQuery(control.fetch);
    const full = await fullCatalogPairs(database);
    const nowMs = () => 0;
    let listener: NotificationListener = () => undefined;
    const source: NotificationSource = {
      subscribe: (added) => {
        listener = added;
        return () => undefined;
      },
      close: () => Promise.resolve(),
    };
    watchCoverageAdded(source);
    control.rewrite = (body) => ({ ...body, spot_classes: [] });
    await loadClassCatalog(client, database, undefined, { nowMs });
    await loadClassCatalog(client, database, undefined, { nowMs });
    expect(control.calls()).toBe(full);
    control.rewrite = null;
    listener("coverage_added", "{}");
    expect((await loadClassCatalog(client, database, undefined, { nowMs })).classes.length).toBeGreaterThan(0);
    expect(control.calls()).toBe(2 * full);
  });

  it("R4.10 a failed load (a 5xx, or a database that did not answer) is never cached, even with no classes (PR #27 review, PM decision)", async () => {
    const control = coverageControl();
    const client = fixtureSolverQuery(control.fetch);
    const full = await fullCatalogPairs(database);
    const nowMs = () => 0;
    control.failing = true;
    await expect(loadClassCatalog(client, database, undefined, { nowMs })).rejects.toBeInstanceOf(ProblemError);
    const afterServerError = control.calls();
    expect(afterServerError).toBeGreaterThan(0);
    await expect(loadClassCatalog(client, database, undefined, { nowMs })).rejects.toBeInstanceOf(ProblemError);
    expect(control.calls()).toBeGreaterThan(afterServerError);
    control.failing = false;
    control.rewrite = (body) => ({ ...body, database: "unavailable", spot_classes: [] });
    await expect(loadClassCatalog(client, database, undefined, { nowMs })).rejects.toBeInstanceOf(ProblemError);
    const afterUnavailable = control.calls();
    control.rewrite = null;
    expect((await loadClassCatalog(client, database, undefined, { nowMs })).classes.length).toBeGreaterThan(0);
    expect(control.calls()).toBe(afterUnavailable + full);
  });

  it("R4.10 buildApp subscribes the catalog invalidation before any automated session exists (PR #27 review MEDIUM 8)", async () => {
    const listeners: NotificationListener[] = [];
    const source: NotificationSource = {
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
      close: () => Promise.resolve(),
    };
    const app = buildApp({ database, config: TEST_CONFIG, notifications: source });
    const twin = buildApp({ database, config: TEST_CONFIG, notifications: source });
    await app.ready();
    const control = coverageControl();
    const client = fixtureSolverQuery(control.fetch);
    const full = await fullCatalogPairs(database);
    await loadClassCatalog(client, database);
    listeners.forEach((listener) => listener("coverage_added", "{}"));
    await loadClassCatalog(client, database);
    expect(control.calls()).toBe(2 * full);
    await app.close();
    await twin.close();
  });
});
