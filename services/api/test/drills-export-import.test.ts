/**
 * GET /drills/{id}/export and POST /drills/import (R3.14, A5 section 3, O-310, O-232, ADR 0001).
 * Export answers the drill's export code; import creates a new drill from a code, never
 * overwriting one, under the user of the session; a code another user exported imports as the
 * importer's own drill. Every refused code is a 400 validation problem pointing at
 * body.export_code, and the responses match the committed contract.
 */
import { deflateSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { EXPORT_CODE_PREFIX, MAX_INFLATED_BYTES } from "../src/drills/export-code.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { problemSchema } from "../src/http/problem.js";
import type { Drill, DrillCreateBody } from "../src/schemas/drills.js";
import { buildTestApp, mutatingHeaders, readHeaders } from "./support/app.js";
import { contractErrors } from "./support/contract.js";
import { appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

const API = "/api/v1";

const DRILL: DrillCreateBody = {
  name: "BB vs BTN mixed region",
  tags: ["bb", "mixed"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BB"],
    villain_positions: ["BTN"],
    preflop_action: ["vs_open"],
    hands: { mode: "close_decisions" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "end_of_street",
    input: "actions",
    grouping: "grouped",
    rng: false,
    pause: "after_mistake",
    speed: "normal",
    quick_result: false,
    tables: 1,
    timebank_s: 15,
    panels: { hero_range_matrix: true, threshold_card: true },
  },
};

interface ProblemBody {
  type: string;
  status: number;
  errors?: { path: string; message: string }[];
}

describe("R3.14 drill export and import routes", () => {
  let database: Database;
  let app: ApiApp;
  let owner: TestSession;
  let other: TestSession;
  let ownerId: string;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    await app.ready();
    ownerId = (await createTestUser(database)).id;
    owner = await createTestSession(database, ownerId);
    other = await createTestSession(database, (await createTestUser(database)).id);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function create(session: TestSession, body: DrillCreateBody = DRILL): Promise<Drill> {
    const response = await app.inject({ method: "POST", url: `${API}/drills`, headers: mutatingHeaders(session), payload: body });
    expect(response.statusCode).toBe(201);
    return response.json<Drill>();
  }

  async function exportCode(session: TestSession, id: string): Promise<string> {
    const response = await app.inject({ method: "GET", url: `${API}/drills/${id}/export`, headers: readHeaders(session) });
    expect(response.statusCode).toBe(200);
    expect(contractErrors("get", "/api/v1/drills/{id}/export", 200, response.json<unknown>())).toEqual([]);
    return response.json<{ export_code: string }>().export_code;
  }

  function importCode(session: TestSession, code: string, key?: string) {
    const headers = { ...mutatingHeaders(session), ...(key === undefined ? {} : { [IDEMPOTENCY_HEADER]: key }) };
    return app.inject({ method: "POST", url: `${API}/drills/import`, headers, payload: { export_code: code } });
  }

  async function refused(code: string): Promise<ProblemBody> {
    const response = await importCode(owner, code);
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    const problem = problemSchema.parse(response.json()) as ProblemBody;
    expect(problem.type).toBe("urn:g-tee-oh:problem:validation");
    expect(problem.errors?.[0]?.path.startsWith("body.export_code")).toBe(true);
    return problem;
  }

  it("R3.14 export then import creates a new drill equal to the original", async () => {
    const original = await create(owner);
    const code = await exportCode(owner, original.id);
    expect(code.startsWith(EXPORT_CODE_PREFIX)).toBe(true);

    const response = await importCode(owner, code);
    expect(response.statusCode).toBe(201);
    const imported = response.json<Drill>();
    expect(contractErrors("post", "/api/v1/drills/import", 201, imported)).toEqual([]);
    expect(imported.id).not.toBe(original.id);
    const fields = (drill: Drill) => ({ name: drill.name, tags: drill.tags, spot_filter: drill.spot_filter, trainer: drill.trainer });
    expect(fields(imported)).toEqual(fields(original));
  });

  it("R3.14 another user's export code imports as the importer's own drill", async () => {
    const theirs = await create(other);
    const code = await exportCode(other, theirs.id);
    const response = await importCode(owner, code);
    expect(response.statusCode).toBe(201);
    const mine = await app.inject({ method: "GET", url: `${API}/drills/${response.json<Drill>().id}`, headers: readHeaders(owner) });
    expect(mine.statusCode).toBe(200);
  });

  it("R3.14 exporting another user's drill is a 404", async () => {
    const theirs = await create(other);
    const response = await app.inject({ method: "GET", url: `${API}/drills/${theirs.id}/export`, headers: readHeaders(owner) });
    expect(response.statusCode).toBe(404);
  });

  it("R3.14 an import replayed with one Idempotency-Key creates one drill", async () => {
    const code = await exportCode(owner, (await create(owner)).id);
    const first = await importCode(owner, code, "drill-import-0001");
    const second = await importCode(owner, code, "drill-import-0001");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(second.json<Drill>().id).toBe(first.json<Drill>().id);
  });

  it("R3.14 a code over 8192 characters is refused by the body schema", async () => {
    const response = await importCode(owner, `${EXPORT_CODE_PREFIX}${"A".repeat(8192)}`);
    expect(response.statusCode).toBe(400);
  });

  it("R3.14 a wrong version prefix is refused", async () => {
    const problem = await refused("gteeoh9.eJxLTEoGAAJNASc");
    expect(problem.errors?.[0]?.message).toContain(EXPORT_CODE_PREFIX);
  });

  it("R3.14 malformed base64url is refused", async () => {
    await refused(`${EXPORT_CODE_PREFIX}not+base64/url=`);
  });

  it("R3.14 a compression bomb is refused", async () => {
    const bomb = deflateSync(Buffer.alloc(MAX_INFLATED_BYTES * 16, 0x20), { level: 9 }).toString("base64url");
    await refused(`${EXPORT_CODE_PREFIX}${bomb}`);
  });

  it("R3.14 unknown keys in the payload are refused with their path", async () => {
    const payload = { ...DRILL, trainer: { ...DRILL.trainer, mystery: true } };
    const code = `${EXPORT_CODE_PREFIX}${deflateSync(Buffer.from(JSON.stringify(payload))).toString("base64url")}`;
    const problem = await refused(code);
    expect(problem.errors?.some((error) => error.path.startsWith("body.export_code.trainer"))).toBe(true);
  });

  it("R3.14 a refused import writes no drill", async () => {
    const before = await database.selectFrom("drill").select("id").where("user_id", "=", ownerId).execute();
    await refused(`${EXPORT_CODE_PREFIX}AAAA`);
    const after = await database.selectFrom("drill").select("id").where("user_id", "=", ownerId).execute();
    expect(after).toHaveLength(before.length);
  });
});
