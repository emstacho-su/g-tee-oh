/**
 * Idempotency-Key guarantees found by the PR #20 review (R3.1, O-232):
 * - HIGH 1: once a handler's write commits, the key is never released, so a retry never writes
 *   twice; the stored response is written in the same transaction as the side effect.
 * - HIGH 2: an in-flight claim older than IDEMPOTENCY_LEASE_SECONDS can be claimed again, so a
 *   crashed request does not block its key for the whole retention window.
 * - L2: a user's keys older than the retention window are purged when that user claims a key.
 *
 * The forced failures are made in Postgres: a trigger (created and dropped by the superuser, keyed
 * to one Idempotency-Key so parallel test files are unaffected) makes the stored-response write
 * fail, and an onSend hook makes the reply fail after the transaction committed.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { requestHash } from "../src/http/canonical-json.js";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../src/http/headers.js";
import { IDEMPOTENCY_LEASE_SECONDS, IDEMPOTENCY_RETENTION_HOURS } from "../src/plugins/idempotency-store.js";
import type { DrillCreateBody } from "../src/schemas/drills.js";
import { buildTestApp, mutatingHeaders } from "./support/app.js";
import { adminPool, appDatabase, createTestSession, createTestUser, type TestSession } from "./support/database.js";

const DRILLS_ROUTE = "/api/v1/drills";
const DRILL: DrillCreateBody = {
  name: "SB vs BB defence",
  tags: ["blinds"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BB"],
    villain_positions: ["SB"],
    preflop_action: ["vs_open"],
    hands: { mode: "all" },
    alternate_seats: false,
  },
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
};

async function asAdmin(statements: readonly string[], params: readonly unknown[][] = []): Promise<void> {
  const admin = adminPool();
  try {
    for (const [index, statement] of statements.entries()) {
      await admin.query(statement, params[index] ?? []);
    }
  } finally {
    await admin.end();
  }
}

describe("R3.1 Idempotency-Key commit, lease and purge (PR #20 review)", () => {
  let database: Database;
  let app: ApiApp;
  let failNextSend = false;

  beforeAll(async () => {
    database = appDatabase();
    app = buildTestApp(database);
    // Fails the reply after the handler (and its transaction) finished, once per arming.
    app.addHook("onSend", async (_request, _reply, payload) => {
      if (failNextSend) {
        failNextSend = false;
        throw new Error("forced failure after commit");
      }
      return payload;
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  async function newSession(): Promise<{ userId: string; session: TestSession }> {
    const user = await createTestUser(database);
    return { userId: user.id, session: await createTestSession(database, user.id) };
  }

  function postDrill(session: TestSession, key: string) {
    return app.inject({
      method: "POST",
      url: DRILLS_ROUTE,
      headers: { ...mutatingHeaders(session), [IDEMPOTENCY_HEADER]: key },
      payload: DRILL,
    });
  }

  async function drillCount(userId: string): Promise<number> {
    const rows = await database.selectFrom("drill").select("id").where("user_id", "=", userId).execute();
    return rows.length;
  }

  it("R3.1 a failure after the drill committed never releases the key: the retry replays, one drill", async () => {
    const { userId, session } = await newSession();
    const key = randomUUID();

    failNextSend = true;
    const failed = await postDrill(session, key);
    const retried = await postDrill(session, key);

    expect(failed.statusCode).toBe(500);
    expect(retried.statusCode).toBe(201);
    expect(retried.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(await drillCount(userId)).toBe(1);
  });

  it("R3.1 a failing stored-response write rolls the drill back, so the retry creates exactly one drill", async () => {
    const { userId, session } = await newSession();
    const key = `force-complete-failure-${randomUUID()}`;
    const fn = `fail_complete_${randomUUID().replaceAll("-", "")}`;
    await asAdmin([
      `create function ${fn}() returns trigger language plpgsql as $$ begin
         if new.key = '${key}' and new.status_code is not null then raise exception 'forced completion failure'; end if;
         return new; end $$`,
      `create trigger ${fn} before update on idempotency_key for each row execute function ${fn}()`,
    ]);

    let failed;
    try {
      failed = await postDrill(session, key);
    } finally {
      await asAdmin([`drop trigger ${fn} on idempotency_key`, `drop function ${fn}()`]);
    }
    expect(failed.statusCode).toBe(500);
    expect(await drillCount(userId)).toBe(0);

    const retried = await postDrill(session, key);
    expect(retried.statusCode).toBe(201);
    expect(retried.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBeUndefined();
    expect(await drillCount(userId)).toBe(1);
  });

  async function seedInFlight(userId: string, key: string, ageSeconds: number): Promise<void> {
    const hash = requestHash({ method: "POST", route: DRILLS_ROUTE, params: {}, body: DRILL });
    await database
      .insertInto("idempotency_key")
      .values({ user_id: userId, key, method: "POST", route: DRILLS_ROUTE, request_hash: hash })
      .execute();
    await asAdmin(
      ["update idempotency_key set created_at = now() - make_interval(secs => $3) where user_id = $1 and key = $2"],
      [[userId, key, ageSeconds]],
    );
  }

  it("R3.1 an in-flight claim younger than the lease still answers 409", async () => {
    const { userId, session } = await newSession();
    const key = randomUUID();
    await seedInFlight(userId, key, IDEMPOTENCY_LEASE_SECONDS / 2);

    const response = await postDrill(session, key);

    expect(response.statusCode).toBe(409);
    expect(await drillCount(userId)).toBe(0);
  });

  it("R3.1 an in-flight claim older than the lease is claimed again and the handler runs once", async () => {
    const { userId, session } = await newSession();
    const key = randomUUID();
    await seedInFlight(userId, key, IDEMPOTENCY_LEASE_SECONDS * 2);

    const response = await postDrill(session, key);
    const replay = await postDrill(session, key);

    expect(response.statusCode).toBe(201);
    expect(replay.headers[IDEMPOTENCY_REPLAYED_HEADER]).toBe("true");
    expect(await drillCount(userId)).toBe(1);
  });

  it("R3.1 a request whose claim was taken over mid-handler answers 409 and writes nothing (re-review LOW 4)", async () => {
    const { userId, session } = await newSession();
    const key = `stale-holder-${randomUUID()}`;
    const fn = `steal_claim_${randomUUID().replaceAll("-", "")}`;
    // Fires inside the handler's transaction, right after the drill insert, as a retry taking the
    // claim over would: the claim_token changes under the running request.
    await asAdmin([
      `create function ${fn}() returns trigger language plpgsql as $$ begin
         update idempotency_key set claim_token = gen_random_uuid() where user_id = new.user_id and key = '${key}';
         return new; end $$`,
      `create trigger ${fn} after insert on drill for each row execute function ${fn}()`,
    ]);

    let response;
    try {
      response = await postDrill(session, key);
    } finally {
      await asAdmin([`drop trigger ${fn} on drill`, `drop function ${fn}()`]);
    }

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe("urn:g-tee-oh:problem:idempotency-in-flight");
    expect(await drillCount(userId)).toBe(0);
  });

  it("R3.1 claiming a key purges the user's keys older than the retention window and keeps younger ones", async () => {
    const { userId, session } = await newSession();
    const other = await newSession();
    const [oldKey, youngKey, otherUsersOldKey] = [randomUUID(), randomUUID(), randomUUID()];
    const hash = Buffer.alloc(32);
    await database
      .insertInto("idempotency_key")
      .values([
        { user_id: userId, key: oldKey, method: "POST", route: "/x", request_hash: hash, status_code: 201 },
        { user_id: userId, key: youngKey, method: "POST", route: "/x", request_hash: hash, status_code: 201 },
        { user_id: other.userId, key: otherUsersOldKey, method: "POST", route: "/x", request_hash: hash, status_code: 201 },
      ])
      .execute();
    const age = "update idempotency_key set created_at = now() - make_interval(hours => $2) where key = $1";
    await asAdmin([age, age, age], [
      [oldKey, IDEMPOTENCY_RETENTION_HOURS + 1],
      [youngKey, IDEMPOTENCY_RETENTION_HOURS - 1],
      [otherUsersOldKey, IDEMPOTENCY_RETENTION_HOURS + 1],
    ]);

    await postDrill(session, randomUUID());

    const keys = await database.selectFrom("idempotency_key").select("key").where("key", "in", [oldKey, youngKey, otherUsersOldKey]).execute();
    expect(keys.map((row) => row.key).sort()).toEqual([youngKey, otherUsersOldKey].sort());
  });
});
