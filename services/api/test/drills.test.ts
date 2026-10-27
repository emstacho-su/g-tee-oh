/**
 * Drill CRUD through the api (R3.14, ADR 0001, A4 drill table). Every route is scoped to the
 * session user: another user's drill answers 404 on read, patch and delete, never 403, so the api
 * does not reveal that the id exists. Mutating requests carry the headers a logged-in browser
 * sends (cookie, x-csrf-token, Origin); the CSRF guard and Idempotency-Key are tested elsewhere.
 * Every 200 and 201 body is checked against the committed OpenAPI contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import type { Drill, DrillCreateBody } from "../src/schemas/drills.js";
import { buildTestApp, mutatingHeaders, readHeaders } from "./support/app.js";
import { contractErrors } from "./support/contract.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

const DRILL: DrillCreateBody = {
  name: "SB vs BB single-raised pots",
  tags: ["srp", "blinds"],
  spot_filter: {
    game_config: { format: "live", table_size: 9, depths_bb: [100] },
    stake: "1/3",
    sizing: { mode: "convention" },
    start_street: "flop",
    hero_positions: ["SB"],
    villain_positions: ["BB"],
    preflop_action: ["srp"],
    board: { suits: "two_tone" },
    hands: { mode: "all" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "end_of_street",
    input: "actions",
    grouping: "standard",
    rng: false,
    pause: "never",
    speed: "normal",
    quick_result: false,
    tables: 1,
    timebank_s: 25,
    panels: { hero_range_matrix: true, equity_distribution_chart: false },
  },
};

const UNKNOWN_DRILL_ID = "01900000-0000-7000-8000-000000000000";
const HOUR_MS = 60 * 60 * 1000;

interface Problem {
  type: string;
  status: number;
  errors?: { path: string; message: string }[];
}

describe("R3.14 drill CRUD", () => {
  let database: Database;
  let app: ApiApp;
  let owner: TestSession;
  let stranger: TestSession;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
    owner = await createTestSession(database, (await createTestUser(database)).id);
    stranger = await createTestSession(database, (await createTestUser(database)).id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function create(session: TestSession, body: DrillCreateBody = DRILL): Promise<Drill> {
    const response = await app.inject({ method: "POST", url: "/api/v1/drills", headers: mutatingHeaders(session), payload: body });
    expect(response.statusCode).toBe(201);
    return response.json<Drill>();
  }

  async function newSession(): Promise<TestSession> {
    return createTestSession(database, (await createTestUser(database)).id);
  }

  it("R3.14 create then get returns the same drill", async () => {
    const created = await create(owner);
    expect(created).toMatchObject({ name: DRILL.name, tags: DRILL.tags, spot_filter: DRILL.spot_filter, trainer: DRILL.trainer });
    expect(contractErrors("post", "/api/v1/drills", 201, created)).toEqual([]);

    const response = await app.inject({ method: "GET", url: `/api/v1/drills/${created.id}`, headers: readHeaders(owner) });
    expect(response.statusCode).toBe(200);
    expect(response.json<Drill>()).toEqual(created);
    expect(contractErrors("get", "/api/v1/drills/{id}", 200, response.json())).toEqual([]);
  });

  it("R3.14 the created row belongs to the session user and stores trainer as trainer_settings", async () => {
    const created = await create(owner);
    const row = await database.selectFrom("drill").selectAll().where("id", "=", created.id).executeTakeFirstOrThrow();
    const ownerUser = await database
      .selectFrom("auth_session")
      .select("user_id")
      .where("id", "=", owner.sessionId)
      .executeTakeFirstOrThrow();
    expect(row.user_id).toBe(ownerUser.user_id);
    expect(row.trainer_settings).toEqual(DRILL.trainer);
    expect(row.spot_filter).toEqual(DRILL.spot_filter);
  });

  it("R3.14 list returns the user's drills newest first, filters by tag and pages", async () => {
    const session = await newSession();
    const first = await create(session, { ...DRILL, name: "first", tags: ["alpha"] });
    const second = await create(session, { ...DRILL, name: "second", tags: ["beta"] });
    const third = await create(session, { ...DRILL, name: "third", tags: ["alpha", "beta"] });
    await create(owner, { ...DRILL, name: "someone else's", tags: ["alpha"] });

    const all = await app.inject({ method: "GET", url: "/api/v1/drills", headers: readHeaders(session) });
    expect(all.statusCode).toBe(200);
    const body = all.json<{ items: Drill[]; next_cursor: string | null }>();
    expect(body.items.map((drill) => drill.id)).toEqual([third.id, second.id, first.id]);
    expect(body.next_cursor).toBeNull();
    expect(contractErrors("get", "/api/v1/drills", 200, body)).toEqual([]);

    const alpha = await app.inject({ method: "GET", url: "/api/v1/drills?tag=alpha", headers: readHeaders(session) });
    expect(alpha.json<{ items: Drill[] }>().items.map((drill) => drill.id)).toEqual([third.id, first.id]);

    const page1 = await app.inject({ method: "GET", url: "/api/v1/drills?limit=2", headers: readHeaders(session) });
    const page1Body = page1.json<{ items: Drill[]; next_cursor: string | null }>();
    expect(page1Body.items.map((drill) => drill.id)).toEqual([third.id, second.id]);
    expect(page1Body.next_cursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/drills?limit=2&cursor=${encodeURIComponent(page1Body.next_cursor ?? "")}`,
      headers: readHeaders(session),
    });
    expect(page2.json<{ items: Drill[]; next_cursor: string | null }>()).toMatchObject({
      items: [{ id: first.id }],
      next_cursor: null,
    });
  });

  it("R3.14 a tampered list cursor is a 400 problem", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/drills?cursor=abc", headers: readHeaders(owner) });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
  });

  it("R3.14 patch changes only the given fields and moves updated_at", async () => {
    const created = await create(owner);
    const past = new Date(Date.now() - HOUR_MS);
    await database.updateTable("drill").set({ updated_at: past }).where("id", "=", created.id).execute();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/drills/${created.id}`,
      headers: mutatingHeaders(owner),
      payload: { name: "renamed", tags: ["renamed"] },
    });

    expect(response.statusCode).toBe(200);
    const patched = response.json<Drill>();
    expect(contractErrors("patch", "/api/v1/drills/{id}", 200, patched)).toEqual([]);
    expect(patched).toMatchObject({
      id: created.id,
      name: "renamed",
      tags: ["renamed"],
      spot_filter: created.spot_filter,
      trainer: created.trainer,
      created_at: created.created_at,
    });
    expect(new Date(patched.updated_at).getTime()).toBeGreaterThan(past.getTime());
  });

  it("R3.14 patch replaces the trainer settings as a whole", async () => {
    const created = await create(owner);
    const trainer = { ...DRILL.trainer, timebank_s: null, panels: {} };
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/drills/${created.id}`,
      headers: mutatingHeaders(owner),
      payload: { trainer },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<Drill>()).toMatchObject({ name: DRILL.name, trainer });
  });

  it("R3.14 delete answers 204, then get is 404", async () => {
    const created = await create(owner);
    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/drills/${created.id}`, headers: mutatingHeaders(owner) });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const response = await app.inject({ method: "GET", url: `/api/v1/drills/${created.id}`, headers: readHeaders(owner) });
    expect(response.statusCode).toBe(404);
    expect(response.json<Problem>().type).toBe("urn:g-tee-oh:problem:not-found");
  });

  it("R3.14 an unknown drill id is 404 on get, patch and delete", async () => {
    const url = `/api/v1/drills/${UNKNOWN_DRILL_ID}`;
    const get = await app.inject({ method: "GET", url, headers: readHeaders(owner) });
    const patch = await app.inject({ method: "PATCH", url, headers: mutatingHeaders(owner), payload: { name: "x" } });
    const remove = await app.inject({ method: "DELETE", url, headers: mutatingHeaders(owner) });
    expect([get.statusCode, patch.statusCode, remove.statusCode]).toEqual([404, 404, 404]);
  });

  it("R3.14 another user cannot get, patch or delete the drill (404, never 403)", async () => {
    const created = await create(owner);
    const url = `/api/v1/drills/${created.id}`;

    const get = await app.inject({ method: "GET", url, headers: readHeaders(stranger) });
    const patch = await app.inject({ method: "PATCH", url, headers: mutatingHeaders(stranger), payload: { name: "stolen" } });
    const remove = await app.inject({ method: "DELETE", url, headers: mutatingHeaders(stranger) });
    expect([get.statusCode, patch.statusCode, remove.statusCode]).toEqual([404, 404, 404]);

    const list = await app.inject({ method: "GET", url: "/api/v1/drills", headers: readHeaders(stranger) });
    expect(list.json<{ items: Drill[] }>().items.map((drill) => drill.id)).not.toContain(created.id);

    const still = await app.inject({ method: "GET", url, headers: readHeaders(owner) });
    expect(still.json<Drill>().name).toBe(DRILL.name);
  });

  it("R3.14 deleting a drill a practice session references is a 409 problem", async () => {
    const created = await create(owner);
    const ownerRow = await database
      .selectFrom("drill")
      .select("user_id")
      .where("id", "=", created.id)
      .executeTakeFirstOrThrow();
    const practice = await database
      .insertInto("practice_session")
      .values({ user_id: ownerRow.user_id, mode: "drill", drill_id: created.id, settings: {}, state: {} })
      .returning("id")
      .executeTakeFirstOrThrow();
    try {
      const response = await app.inject({ method: "DELETE", url: `/api/v1/drills/${created.id}`, headers: mutatingHeaders(owner) });
      expect(response.statusCode).toBe(409);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.json<Problem>().type).toBe("urn:g-tee-oh:problem:conflict");

      const still = await app.inject({ method: "GET", url: `/api/v1/drills/${created.id}`, headers: readHeaders(owner) });
      expect(still.statusCode).toBe(200);
    } finally {
      await database.deleteFrom("practice_session").where("id", "=", practice.id).execute();
    }
  });

  it("R3.14 an unknown key in spot_filter is a 400 problem with an errors list", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/drills",
      headers: mutatingHeaders(owner),
      payload: { ...DRILL, spot_filter: { ...DRILL.spot_filter, not_a_field: true } },
    });
    expect(response.statusCode).toBe(400);
    const problem = response.json<Problem>();
    expect(problem.type).toBe("urn:g-tee-oh:problem:validation");
    expect(problem.errors?.length).toBeGreaterThan(0);
  });

  it("R3.14 a bad tag is a 400 problem naming the tag", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/drills",
      headers: mutatingHeaders(owner),
      payload: { ...DRILL, tags: ["Not A Tag"] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.some((error) => error.path.includes("tags"))).toBe(true);
  });

  it("R3.14 a bad tag filter on the list is a 400 problem", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/drills?tag=Bad%20Tag", headers: readHeaders(owner) });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.length).toBeGreaterThan(0);
  });

  it("R3.14 an empty patch body is a 400 problem with an errors list", async () => {
    const created = await create(owner);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/drills/${created.id}`,
      headers: mutatingHeaders(owner),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.length).toBeGreaterThan(0);
  });

  it.each([
    ["GET", "/api/v1/drills"],
    ["GET", `/api/v1/drills/${UNKNOWN_DRILL_ID}`],
    ["POST", "/api/v1/drills"],
    ["PATCH", `/api/v1/drills/${UNKNOWN_DRILL_ID}`],
    ["DELETE", `/api/v1/drills/${UNKNOWN_DRILL_ID}`],
  ] as const)("R3.14 %s %s without a session is a 401 problem", async (method, url) => {
    const response = await app.inject({ method, url, ...(method === "GET" ? {} : { payload: DRILL }) });
    expect(response.statusCode).toBe(401);
  });
});
