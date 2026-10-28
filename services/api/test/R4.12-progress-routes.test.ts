/**
 * The six progress routes (R4.12, O-271 to O-279) over the test database and the fixture
 * solver-query: 401 without a session, 400 for a malformed query or a cursor the route never issued,
 * cursor pagination of the tracks, and each route's body for a new user and for seeded learning
 * rows, every 200 body checked against the committed contract (packages/contracts/api.openapi.json).
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import { loadClassCatalog, type ClassCatalog } from "../src/automated/class-catalog.js";
import type { Database } from "../src/db.js";
import { TRACK_KEYS } from "../src/learning/tracks.js";
import { DEFAULT_LEAK_WEEKS } from "../src/schemas/insights.js";
import { mondayOf } from "../src/streaks/calendar.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";
import { newPlayer, type Player } from "./sessions-test-kit.js";

const PATHS = ["rating", "tracks", "leaks", "heatmap", "holdout", "streak"] as const;
const PAGE = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

let database: Database;
let pool: pg.Pool;
let app: ApiApp;
let catalog: ClassCatalog;

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  app = buildTrainerApp(database);
  await app.ready();
  catalog = await loadClassCatalog(fixtureSolverQuery(), database);
}, 300_000);

afterAll(async () => {
  await app.close();
  await pool.end();
  await database.destroy();
});

async function get(player: Player | null, path: string) {
  const response = await app.inject({ method: "GET", url: `/api/v1/progress/${path}`, headers: player?.read ?? {} });
  return response;
}

async function okBody<T>(player: Player, path: string): Promise<T> {
  const response = await get(player, path);
  expect(response.statusCode, response.body).toBe(200);
  const route = `/api/v1/progress/${path.split("?")[0] ?? path}`;
  expect(contractErrors("get", route, 200, response.json()), route).toEqual([]);
  return response.json<T>();
}

describe("R4.12 progress route guards", () => {
  it("R4.12 every progress route is 401 without a session", async () => {
    for (const path of PATHS) {
      expect((await get(null, path)).statusCode, path).toBe(401);
    }
  });

  it("R4.12 malformed queries and foreign cursors are 400", async () => {
    const player = await newPlayer(database);
    for (const path of ["leaks?weeks=0", "leaks?weeks=53", "tracks?limit=0", "tracks?cursor=bm90LWEtY3Vyc29y", "holdout?cursor=e30", "holdout?limit=201"]) {
      expect((await get(player, path)).statusCode, path).toBe(400);
    }
  });
});

describe("R4.12 progress for a new user", () => {
  it("R4.12 no rating card, every track at the defaults, empty leaks, holdout and streak", async () => {
    const player = await newPlayer(database);
    expect(await okBody(player, "rating")).toEqual({ overall: null, updated_at: null });
    const leaks = await okBody<{ weeks: string[]; items: unknown[] }>(player, "leaks");
    expect(leaks.weeks).toHaveLength(DEFAULT_LEAK_WEEKS);
    expect(leaks.weeks.at(-1)).toBe(mondayOf(new Date().toISOString().slice(0, 10)));
    expect(leaks.items).toEqual([]);
    expect(await okBody(player, "holdout")).toEqual({ items: [], next_cursor: null, open: null });
    expect(await okBody(player, "streak")).toMatchObject({ current_days: 0, longest_days: 0, today_rated: 0, freezes_left_this_week: 2, unlocks: [] });
    const heatmap = await okBody<{ cells: { n: number; p_known: number | null }[] }>(player, "heatmap");
    expect(heatmap.cells).toHaveLength(catalog.classes.length);
    expect(heatmap.cells.every((cell) => cell.n === 0 && cell.p_known === null)).toBe(true);
  });

  it("R4.12 the tracks page in order with a cursor, their weights summing to 1", async () => {
    const player = await newPlayer(database);
    const keys: string[] = [];
    let weight = 0;
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? `tracks?limit=${PAGE}` : `tracks?limit=${PAGE}&cursor=${cursor}`;
      const page: { items: { track_key: string; weight: number; mu: number; rated_decisions: number }[]; next_cursor: string | null } = await okBody(player, query);
      keys.push(...page.items.map((item) => item.track_key));
      weight += page.items.reduce((sum, item) => sum + item.weight, 0);
      expect(page.items.every((item) => item.mu === 1500 && item.rated_decisions === 0)).toBe(true);
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor !== null);
    expect(keys).toEqual([...TRACK_KEYS]);
    expect(pages).toBe(Math.ceil(TRACK_KEYS.length / PAGE));
    expect(weight).toBeCloseTo(1);
  });
});

describe("R4.12 progress over seeded learning rows", () => {
  it("R4.12 a rating row gives the rating card and the track's figures", async () => {
    const player = await newPlayer(database);
    const updated = new Date();
    await pool.query("insert into rating (user_id, track_id, mu, rd, volatility, updated_at) select $1, id, 1800, 60, 0.06, $2 from track where key = 'opens'", [player.userId, updated]);
    const rating = await okBody<{ overall: { mu: number; tier: string } | null; updated_at: string }>(player, "rating");
    expect(rating.overall).not.toBeNull();
    expect(rating.updated_at).toBe(updated.toISOString());
    const tracks = await okBody<{ items: { track_key: string; mu: number; rd: number; conservative: number }[] }>(player, "tracks");
    expect(tracks.items.find((item) => item.track_key === "opens")).toMatchObject({ mu: 1800, rd: 60, conservative: 1680 });
  });

  it("R4.12 leak stats and history give the top leaks with their weekly series; mastery fills its heat map cell", async () => {
    const player = await newPlayer(database);
    const [first, second] = catalog.classes;
    if (first === undefined || second === undefined) {
      throw new Error("the fixture catalog needs two classes");
    }
    const insertStat = "insert into leak_stat (user_id, spot_class_key, freq_prior_per_1k, n, miss_rate, ev_per_miss_bb, leak_cost_bb_per_1k, computed_at) values ($1, $2, 10, 12, 0.5, 1, $3, now())";
    await pool.query(insertStat, [player.userId, first.spotClassKey, 5]);
    await pool.query(insertStat, [player.userId, second.spotClassKey, 7]);
    await pool.query(insertStat, [player.userId, "no-longer-in-the-catalog", 99]);
    const lastWeek = mondayOf(new Date(Date.now() - WEEK_DAYS * DAY_MS).toISOString().slice(0, 10));
    await pool.query("insert into leak_history (user_id, spot_class_key, week, leak_cost_bb_per_1k) values ($1, $2, $3, 6.5)", [player.userId, second.spotClassKey, lastWeek]);
    await pool.query("insert into mastery (user_id, spot_class_key, p_known, updated_at) values ($1, $2, 0.97, now())", [player.userId, first.spotClassKey]);
    const leaks = await okBody<{ weeks: string[]; items: { spot_class_key: string; family: string; series: { week: string; leak_cost_bb_per_1k: number | null; partial: boolean }[] }[] }>(player, "leaks?weeks=2");
    expect(leaks.items.map((item) => item.spot_class_key)).toEqual([second.spotClassKey, first.spotClassKey]);
    expect(leaks.items[0]?.family).toBe(second.family);
    expect(leaks.items[0]?.series).toEqual([
      { week: lastWeek, leak_cost_bb_per_1k: 6.5, partial: false },
      { week: leaks.weeks[1], leak_cost_bb_per_1k: 7, partial: true },
    ]);
    const heatmap = await okBody<{ cells: { spot_class_key: string; p_known: number | null; mastered: boolean }[] }>(player, "heatmap");
    const cell = heatmap.cells.find((candidate) => candidate.spot_class_key === first.spotClassKey);
    expect(cell?.p_known).toBeCloseTo(0.97);
    expect(cell?.mastered).toBe(true);
  });
});
