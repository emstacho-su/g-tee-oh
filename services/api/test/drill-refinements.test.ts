/**
 * Cross-field rules of the drill spot filter from the PR #20 review (R3.14, M4): positions must be
 * seated at the table size (the seat lists pinned from gto-model, O-234), hero and villain
 * positions are disjoint, the stake label matches the format, and no list repeats a value. Each
 * is a 400 at the boundary, both in the schema and through POST /drills.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { drillPatchBodySchema, spotFilterSchema, type SpotFilter } from "../src/schemas/drills.js";
import { sql } from "kysely";

import { buildTestApp, mutatingHeaders, readHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser } from "./support/database.js";

const VALID: SpotFilter = {
  game_config: { format: "live", table_size: 9, depths_bb: [100, 200] },
  stake: "1/3",
  sizing: { mode: "convention" },
  start_street: "preflop",
  hero_positions: ["BTN", "CO"],
  villain_positions: ["BB"],
  preflop_action: ["rfi", "vs_open"],
  hands: { mode: "manual", hands: ["AKs", "QQ"] },
  alternate_seats: false,
};

function withFields(overrides: Partial<SpotFilter>): unknown {
  return { ...VALID, ...overrides };
}

function issuePaths(value: unknown): string[] {
  const result = spotFilterSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("R3.14 spot filter cross-field rules (M4)", () => {
  it("R3.14 a consistent filter parses", () => {
    expect(spotFilterSchema.safeParse(VALID).success).toBe(true);
    expect(
      spotFilterSchema.safeParse(
        withFields({ game_config: { format: "online", table_size: 6, depths_bb: [100] }, stake: "online", hero_positions: ["UTG"] }),
      ).success,
    ).toBe(true);
  });

  it("R3.14 a position not seated at the table size is rejected", () => {
    const sixMax = { format: "online" as const, table_size: 6, depths_bb: [100] };
    expect(issuePaths(withFields({ game_config: sixMax, stake: "online", hero_positions: ["LJ"] }))).toContain("hero_positions.0");
    expect(issuePaths(withFields({ game_config: sixMax, stake: "online", villain_positions: ["UTG1"] }))).toContain(
      "villain_positions.0",
    );
    const headsUp = { format: "online" as const, table_size: 2, depths_bb: [100] };
    expect(issuePaths(withFields({ game_config: headsUp, stake: "online", hero_positions: ["SB"], villain_positions: [] }))).toContain(
      "hero_positions.0",
    );
  });

  it("R3.14 hero and villain positions must be disjoint", () => {
    expect(issuePaths(withFields({ hero_positions: ["BTN"], villain_positions: ["BTN", "BB"] }))).toContain("villain_positions.0");
  });

  it("R3.14 the stake label must match the format", () => {
    expect(issuePaths(withFields({ stake: "online" }))).toContain("stake");
    expect(
      issuePaths(withFields({ game_config: { format: "online", table_size: 6, depths_bb: [100] }, stake: "1/3", hero_positions: ["BTN"] })),
    ).toContain("stake");
    expect(issuePaths(withFields({ stake: "one-three" }))).toContain("stake");
  });

  it("R3.14 no list repeats a value", () => {
    expect(issuePaths(withFields({ game_config: { format: "live", table_size: 9, depths_bb: [100, 100] } }))).toContain(
      "game_config.depths_bb.1",
    );
    expect(issuePaths(withFields({ hero_positions: ["BTN", "BTN"] }))).toContain("hero_positions.1");
    expect(issuePaths(withFields({ villain_positions: ["BB", "BB"] }))).toContain("villain_positions.1");
    expect(issuePaths(withFields({ preflop_action: ["rfi", "rfi"] }))).toContain("preflop_action.1");
    expect(issuePaths(withFields({ hands: { mode: "manual", hands: ["AKs", "AKs"] } }))).toContain("hands.hands.1");
  });

  it("R3.14 a board flop must hold three distinct cards (PR #30 review LOW 12)", () => {
    expect(issuePaths(withFields({ board: { flops: ["Kh7d2c", "KhKh3c"] } }))).toEqual(["board.flops.1"]);
    expect(issuePaths(withFields({ board: { flops: ["3c4c3c"] } }))).toEqual(["board.flops.0"]);
    expect(issuePaths(withFields({ board: { flops: ["Kh7d2c", "KdKh3c"] } }))).toEqual([]);
  });

  it("R3.14 the patch body applies the same rules to a spot filter", () => {
    expect(drillPatchBodySchema.safeParse({ spot_filter: withFields({ hero_positions: ["BTN", "BTN"] }) }).success).toBe(false);
  });
});

describe("R3.14 spot filter rules at the HTTP boundary (M4)", () => {
  let database: Database;
  let app: ApiApp;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it("R3.14 POST /drills with a position not seated at the table size is a 400 validation problem", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/drills",
      headers: mutatingHeaders(session),
      payload: {
        name: "bad seats",
        spot_filter: withFields({ game_config: { format: "online", table_size: 6, depths_bb: [100] }, stake: "online", hero_positions: ["UTG2"] }),
        trainer: {
          stop_rule: "after_action",
          input: "actions",
          grouping: "standard",
          rng: false,
          pause: "never",
          speed: "normal",
          quick_result: false,
          tables: 1,
          timebank_s: null,
          panels: {},
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ type: string; errors: Array<{ path: string }> }>()).toMatchObject({
      type: "urn:g-tee-oh:problem:validation",
    });
  });

  it("R3.14 POST /drills with a board flop that repeats a card is a 400 at that flop (LOW 12)", async () => {
    const session = await createTestSession(database, (await createTestUser(database)).id);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/drills",
      headers: mutatingHeaders(session),
      payload: {
        name: "repeated card",
        spot_filter: withFields({ board: { flops: ["KhKh3c"] } }),
        trainer: {
          stop_rule: "after_action",
          input: "actions",
          grouping: "standard",
          rng: false,
          pause: "never",
          speed: "normal",
          quick_result: false,
          tables: 1,
          timebank_s: null,
          panels: {},
        },
      },
    });
    expect(response.statusCode).toBe(400);
    const paths = response.json<{ errors: Array<{ path: string }> }>().errors.map((error) => error.path);
    expect(paths).toEqual(["body.spot_filter.board.flops.0"]);
  });

  it("R3.14 a stored drill written before the rules (a legacy row) still lists and reads (re-review LOW 3)", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);
    const legacy = withFields({ hero_positions: ["BTN", "BTN"], villain_positions: ["BTN"], stake: "online" });
    const trainer = {
      stop_rule: "after_action",
      input: "actions",
      grouping: "standard",
      rng: false,
      pause: "never",
      speed: "normal",
      quick_result: false,
      tables: 1,
      timebank_s: null,
      panels: {},
    };
    const row = await database
      .insertInto("drill")
      .values({
        user_id: user.id,
        name: "legacy",
        spot_filter: sql`cast(${JSON.stringify(legacy)} as jsonb)`,
        trainer_settings: sql`cast(${JSON.stringify(trainer)} as jsonb)`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const list = await app.inject({ method: "GET", url: "/api/v1/drills", headers: readHeaders(session) });
    const one = await app.inject({ method: "GET", url: `/api/v1/drills/${row.id}`, headers: readHeaders(session) });

    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual([row.id]);
    expect(one.statusCode).toBe(200);
  });
});
