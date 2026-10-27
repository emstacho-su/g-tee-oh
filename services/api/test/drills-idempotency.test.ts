/**
 * The R3.1 proof on a real route (A5 section 3, O-232): a double-submitted POST /drills with one
 * Idempotency-Key creates one drill and replays the first response. S23 repeats this test on
 * POST /sessions/{id}/decisions, where "handled once" means "graded once".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import type { DrillCreateBody } from "../src/schemas/drills.js";
import { buildTestApp, mutatingHeaders } from "./support/app.js";
import { appDatabase, createTestSession, createTestUser } from "./support/database.js";

const DRILL: DrillCreateBody = {
  name: "BTN RFI boundary hands",
  tags: ["rfi", "boundary"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BTN"],
    villain_positions: [],
    preflop_action: ["rfi"],
    hands: { mode: "close_decisions" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "after_action",
    input: "actions",
    grouping: "standard",
    rng: false,
    pause: "after_mistake",
    speed: "normal",
    quick_result: false,
    tables: 1,
    timebank_s: null,
    panels: { hero_range_matrix: true },
  },
};

describe("R3.1 Idempotency-Key on POST /drills", () => {
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

  it("R3.1 a double-submitted POST /drills with one Idempotency-Key creates one drill and replays the response", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);
    const headers = { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: "drill-create-0001" };

    const first = await app.inject({ method: "POST", url: "/api/v1/drills", headers, payload: DRILL });
    const second = await app.inject({ method: "POST", url: "/api/v1/drills", headers, payload: DRILL });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json<unknown>()).toEqual(first.json<unknown>());
    expect(second.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    const rows = await database.selectFrom("drill").select("id").where("user_id", "=", user.id).execute();
    expect(rows).toHaveLength(1);
  });

  it("R3.1 without an Idempotency-Key the same POST /drills creates two drills", async () => {
    const user = await createTestUser(database);
    const session = await createTestSession(database, user.id);
    const headers = mutatingHeaders(session);

    await app.inject({ method: "POST", url: "/api/v1/drills", headers, payload: DRILL });
    await app.inject({ method: "POST", url: "/api/v1/drills", headers, payload: DRILL });

    const rows = await database.selectFrom("drill").select("id").where("user_id", "=", user.id).execute();
    expect(rows).toHaveLength(2);
  });
});
