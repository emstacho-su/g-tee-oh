/**
 * The catalog routes against the R0.6 seed (R3.2, ADR 0014, O-234, criterion 11). The seed holds
 * three stakes (online, 1/3, 2/5 with the O-66 note) and eleven configurations; these tests read
 * them through the api as the app role, page through them with opaque cursors, and check every
 * 200 body against the committed OpenAPI contract (test/support/contract.ts).
 *
 * The preflop_available test writes solution rows with the superuser pool, because the app role
 * can only read the library, and deletes them again in a finally block.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import type { GameConfig, PositionPairEntry, Stake } from "../src/schemas/catalog.js";
import { buildTestApp, readHeaders } from "./support/app.js";
import { contractErrors } from "./support/contract.js";
import { adminPool, appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

const SEEDED_CONFIG_IDS = [
  "cfg_6_online_100",
  "cfg_6_online_150",
  "cfg_6_online_200",
  "cfg_9_live_13_100",
  "cfg_9_live_13_150",
  "cfg_9_live_13_200",
  "cfg_9_live_13_300",
  "cfg_9_live_25_100",
  "cfg_9_live_25_150",
  "cfg_9_live_25_200",
  "cfg_9_live_25_300",
];

// The same vector test/seats.test.ts pins from gto-model, for the two seeded table sizes.
const SIX_MAX_PAIRS =
  "UTG-HJ,UTG-CO,UTG-BTN,SB-UTG,BB-UTG,HJ-CO,HJ-BTN,SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB".split(",");
const NINE_HANDED_PAIRS = (
  "UTG-UTG1,UTG-UTG2,UTG-LJ,UTG-HJ,UTG-CO,UTG-BTN,SB-UTG,BB-UTG,UTG1-UTG2,UTG1-LJ,UTG1-HJ,UTG1-CO,UTG1-BTN," +
  "SB-UTG1,BB-UTG1,UTG2-LJ,UTG2-HJ,UTG2-CO,UTG2-BTN,SB-UTG2,BB-UTG2,LJ-HJ,LJ-CO,LJ-BTN,SB-LJ,BB-LJ,HJ-CO,HJ-BTN," +
  "SB-HJ,BB-HJ,CO-BTN,SB-CO,BB-CO,SB-BTN,BB-BTN,SB-BB"
).split(",");

const PAGE_LIMIT = 4;
const PREFLOP_CONFIG = "cfg_9_live_25_300";
const PUBLISHED_PAIR = "BB-BTN";

interface Page<Item> {
  items: Item[];
  next_cursor: string | null;
}

describe("R3.2 catalog routes", () => {
  let database: Database;
  let app: ApiApp;
  let session: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
    const user = await createTestUser(database);
    session = await createTestSession(database, user.id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function get<Body>(url: string): Promise<{ status: number; body: Body }> {
    const response = await app.inject({ method: "GET", url, headers: readHeaders(session) });
    return { status: response.statusCode, body: response.json<Body>() };
  }

  async function walk<Item>(firstUrl: string): Promise<{ items: Item[]; pages: number; lastCursor: string | null }> {
    const collected: Item[] = [];
    let url: string | null = firstUrl;
    let pages = 0;
    let lastCursor: string | null = null;
    while (url !== null) {
      const { status, body }: { status: number; body: Page<Item> } = await get<Page<Item>>(url);
      expect(status).toBe(200);
      collected.push(...body.items);
      pages += 1;
      lastCursor = body.next_cursor;
      url = body.next_cursor === null ? null : `${firstUrl}&cursor=${encodeURIComponent(body.next_cursor)}`;
    }
    return { items: collected, pages, lastCursor };
  }

  it("R3.2 /stakes returns the three seeded stakes with the 2/5 note", async () => {
    const { status, body } = await get<Page<Stake>>("/api/v1/stakes");

    expect(status).toBe(200);
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((stake) => stake.label).sort()).toEqual(["1/3", "2/5", "online"]);
    const twoFive = body.items.find((stake) => stake.label === "2/5");
    expect(twoFive).toMatchObject({ format: "live", bb_cents: 500, rake_percent_bp: 1000, rake_cap_cents: 500 });
    expect(twoFive?.note).toContain("O-66");
    expect(body.items.find((stake) => stake.label === "1/3")?.note).toBeNull();
    expect(contractErrors("get", "/api/v1/stakes", 200, body)).toEqual([]);
  });

  it("R3.2 the contract helper rejects a body that drifts from the committed schema", () => {
    const drifted = { items: [{ id: "not-a-uuid", label: "1/3" }], next_cursor: null };
    expect(contractErrors("get", "/api/v1/stakes", 200, drifted).length).toBeGreaterThan(0);
    expect(contractErrors("get", "/api/v1/stakes", 200, { items: [], next_cursor: null, extra: 1 }).length).toBeGreaterThan(0);
    expect(() => contractErrors("get", "/api/v1/no-such-route", 200, {})).toThrow(/no GET/);
  });

  it("R3.2 /stakes filters by format", async () => {
    const { body } = await get<Page<Stake>>("/api/v1/stakes?format=live");
    expect(body.items.map((stake) => stake.label).sort()).toEqual(["1/3", "2/5"]);
  });

  it("R3.2 /configs lists every seeded configuration with its stake", async () => {
    const { status, body } = await get<Page<GameConfig>>("/api/v1/configs");

    expect(status).toBe(200);
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((config) => config.config_id).sort()).toEqual([...SEEDED_CONFIG_IDS].sort());
    const live13 = body.items.find((config) => config.config_id === "cfg_9_live_13_150");
    expect(live13).toMatchObject({ format: "live", table_size: 9, stake_label: "1/3", depth_cbb: 15000, straddle: false, ante_cbb: 0 });
    expect(contractErrors("get", "/api/v1/configs", 200, body)).toEqual([]);
  });

  it("R3.2 1/3 and 2/5 configurations at the same table size and depth have different config_id and stake_id (criterion 11)", async () => {
    const { body } = await get<Page<GameConfig>>("/api/v1/configs?format=live");
    const oneThree = body.items.find((config) => config.config_id === "cfg_9_live_13_100");
    const twoFive = body.items.find((config) => config.config_id === "cfg_9_live_25_100");

    expect(oneThree).toBeDefined();
    expect(twoFive).toBeDefined();
    expect(oneThree?.table_size).toBe(twoFive?.table_size);
    expect(oneThree?.depth_cbb).toBe(twoFive?.depth_cbb);
    expect(oneThree?.config_id).not.toBe(twoFive?.config_id);
    expect(oneThree?.stake_id).not.toBe(twoFive?.stake_id);
    expect([oneThree?.stake_label, twoFive?.stake_label]).toEqual(["1/3", "2/5"]);
  });

  it("R3.2 /configs filters by format, stake_id and table_size", async () => {
    const online = await get<Page<GameConfig>>("/api/v1/configs?format=online");
    expect(online.body.items.map((config) => config.config_id).sort()).toEqual([
      "cfg_6_online_100",
      "cfg_6_online_150",
      "cfg_6_online_200",
    ]);

    const nine = await get<Page<GameConfig>>("/api/v1/configs?table_size=9");
    expect(nine.body.items).toHaveLength(8);

    const stakes = await get<Page<Stake>>("/api/v1/stakes");
    const twoFiveId = stakes.body.items.find((stake) => stake.label === "2/5")?.id ?? "";
    const twoFive = await get<Page<GameConfig>>(`/api/v1/configs?stake_id=${twoFiveId}`);
    expect(twoFive.body.items.map((config) => config.config_id).sort()).toEqual([
      "cfg_9_live_25_100",
      "cfg_9_live_25_150",
      "cfg_9_live_25_200",
      "cfg_9_live_25_300",
    ]);

    const none = await get<Page<GameConfig>>("/api/v1/configs?format=online&table_size=9");
    expect(none.body).toEqual({ items: [], next_cursor: null });
  });

  it("R3.2 /configs pages through all eleven with limit 4, no repeats, and a null final cursor", async () => {
    const { items, pages, lastCursor } = await walk<GameConfig>(`/api/v1/configs?limit=${PAGE_LIMIT}`);
    const ids = items.map((config) => config.config_id);

    expect(pages).toBe(3);
    expect(lastCursor).toBeNull();
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...SEEDED_CONFIG_IDS].sort());
  });

  it("R3.2 /stakes pages with limit 1 without repeats", async () => {
    const { items, pages } = await walk<Stake>("/api/v1/stakes?limit=1");
    expect(pages).toBe(3);
    expect(new Set(items.map((stake) => stake.id)).size).toBe(3);
  });

  it.each(["/api/v1/configs", "/api/v1/stakes", "/api/v1/configs/cfg_6_online_100/pairs"])(
    "R3.2 a tampered cursor on %s is a 400 problem",
    async (path) => {
      const forged = Buffer.from(JSON.stringify({ id: 42 }), "utf8").toString("base64url");
      for (const cursor of ["not-base64-json", forged]) {
        const response = await app.inject({ method: "GET", url: `${path}?cursor=${cursor}`, headers: readHeaders(session) });
        expect(response.statusCode).toBe(400);
        expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      }
    },
  );

  it("R3.2 pairs for cfg_6_online_100 are the 15 six-max pairs, in gto-model order", async () => {
    const { status, body } = await get<Page<PositionPairEntry> & { config_id: string }>(
      "/api/v1/configs/cfg_6_online_100/pairs",
    );

    expect(status).toBe(200);
    expect(body.config_id).toBe("cfg_6_online_100");
    expect(body.items.map((entry) => entry.pair)).toEqual(SIX_MAX_PAIRS);
    // The global setup seeds solution rows for the fixture library (S23, scripts/fixture-solutions.mjs),
    // whose synthetic 6-max set holds every pair of cfg_6_online_100.
    expect(body.items[0]).toEqual({ pair: "UTG-HJ", oop: "UTG", ip: "HJ", preflop_available: true });
    expect(contractErrors("get", "/api/v1/configs/{id}/pairs", 200, body)).toEqual([]);
  });

  it("R3.2 pairs for cfg_9_live_13_100 are the 36 nine-handed pairs, also when paged", async () => {
    const whole = await get<Page<PositionPairEntry>>("/api/v1/configs/cfg_9_live_13_100/pairs");
    expect(whole.body.items.map((entry) => entry.pair)).toEqual(NINE_HANDED_PAIRS);

    const paged = await walk<PositionPairEntry>("/api/v1/configs/cfg_9_live_13_100/pairs?limit=10");
    expect(paged.pages).toBe(4);
    expect(paged.items.map((entry) => entry.pair)).toEqual(NINE_HANDED_PAIRS);
  });

  it("R3.2 preflop_available is true only for a pair with a published preflop solution", async () => {
    const pool: pg.Pool = adminPool();
    const inserted: string[] = [];
    try {
      const insert = async (kind: string, pair: string, status: string): Promise<void> => {
        const result = await pool.query<{ id: string }>(
          `insert into solution (kind, source, game_config_id, position_pair, manifest_uri, status)
           values ($1, 'own', $2, $3, 's3://library/test/manifest.json', $4) returning id`,
          [kind, PREFLOP_CONFIG, pair, status],
        );
        inserted.push(...result.rows.map((row) => row.id));
      };
      await insert("preflop", PUBLISHED_PAIR, "published");
      await insert("preflop", "SB-BB", "superseded");
      await insert("flop_build", "CO-BTN", "published");

      const { body } = await get<Page<PositionPairEntry>>(`/api/v1/configs/${PREFLOP_CONFIG}/pairs`);
      const available = body.items.filter((entry) => entry.preflop_available).map((entry) => entry.pair);
      expect(available).toEqual([PUBLISHED_PAIR]);

      const other = await get<Page<PositionPairEntry>>("/api/v1/configs/cfg_9_live_13_300/pairs");
      expect(other.body.items.some((entry) => entry.preflop_available)).toBe(false);
    } finally {
      await pool.query("delete from solution where id = any($1::uuid[])", [inserted]);
      await pool.end();
    }
  });

  it("R3.2 an unknown configuration is a 404 problem", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/configs/cfg_9_live_13_999/pairs",
      headers: readHeaders(session),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:not-found");
  });

  it.each(["/api/v1/stakes", "/api/v1/configs", "/api/v1/configs/cfg_6_online_100/pairs"])(
    "R3.2 %s without a session is a 401 problem",
    async (url) => {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    },
  );
});
