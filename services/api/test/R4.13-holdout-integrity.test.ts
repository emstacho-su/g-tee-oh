/**
 * Holdout integrity (R4.13, O-276, PR #27 review HIGH 1, HIGH 4 and MEDIUM 9) on a database of its
 * own (R4.13-isolated-database.ts), against the fixture solver-query behind a fetch a test can make
 * fail or hang for one item's deal:
 * - HIGH 1: the round's items are served in one order fixed per (user, round) by the round's order
 *   seed; a create always resumes at the first unanswered item; an item a session served counts as
 *   answered with score 0 and outcome skipped once that session ends or a new create replaces it, so
 *   repeated create, view and end never serves an item twice; one open holdout session per user.
 * - HIGH 4 and O-334: the next item is prepared before the decision transaction. Only a
 *   deterministic replay failure (a mismatching deal, or a 4xx from solver-query) records that item
 *   unservable for the round. A transient one (a 5xx, a 503, a replay that outlives its per-call
 *   deadline) stops the search and leaves the item unresolved: a decision still commits, with no next
 *   item prepared, and a create answers 503; either way the next create serves that item.
 * - The session-end tier reads the prepared catalog: none prepared is a 503 before any write.
 * - MEDIUM 9: once every track is drawn, the draw job returns before it loads the catalog and the
 *   job is no longer scheduled.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp, type ApiApp } from "../src/app.js";
import { loadClassCatalog } from "../src/automated/class-catalog.js";
import { drawPort } from "../src/holdout/draw-port.js";
import { drawTrackItems, HOLDOUT_ITEMS_PER_TRACK } from "../src/holdout/draw.js";
import { HOLDOUT_HOOK_PART } from "../src/holdout/effects.js";
import { holdoutItems, recordDraw, type HoldoutItem } from "../src/holdout/repository.js";
import * as sessionItems from "../src/holdout/session-items.js";
import { HOLDOUT_DRAW_JOB, HOLDOUT_DRAW_KIND, runHoldoutDraw } from "../src/jobs/holdout-draw.js";
import type { ClaimedJob } from "../src/jobs/repository.js";
import { ensureScheduled } from "../src/jobs/schedule.js";
import { EMPTY_PREPARED_LEARNING, NO_LEARNING_HOOKS } from "../src/learning/effects.js";
import { promptSchema, sessionSchema } from "../src/schemas/training.js";
import type { SessionRow } from "../src/sessions/repository.js";
import { HOLDOUT_SETTINGS, HOLDOUT_SESSION_SPOT } from "../src/sessions/modes/holdout.js";
import { initialState, persistedStateSchema, type HoldoutLearning } from "../src/sessions/state.js";
import { TEST_CONFIG } from "./support/app.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { automatedLearning } from "./R4.11-learning-state-kit.js";
import { faults, faultyFetch, type DealFault } from "./R4.13-deal-faults.js";
import { isolatedDatabase, type IsolatedDatabase } from "./R4.13-isolated-database.js";
import { newPlayer, type Player } from "./sessions-test-kit.js";

const TRACK = "opens";
const DRAW_SEED = "00000000000000a1";
const LONG_TEST_MS = 600_000;
const RESPONSE_MS = 1500;
const REPEATS = 3;
/** A deterministic upstream failure (O-334): solver-query cannot deal the stored spot. */
const DETERMINISTIC_STATUS = 422;
/** A transient upstream failure (O-334): solver-query is unavailable for now. */
const TRANSIENT_STATUS = 503;
/** The hanging-deal test: the per-call deadline must free the decision well inside this. */
const HANG_TEST_MS = 60_000;

let iso: IsolatedDatabase;
let app: ApiApp;
let player: Player;
let items: HoldoutItem[];

function job(kind: string, periodKey: string): ClaimedJob {
  const now = new Date();
  return { id: randomUUID(), kind, periodKey, runAt: now, attempts: 1, lockedBy: "r4.13-integrity", lockedAt: now };
}

function createHoldout(who: Player = player) {
  return app.inject({ method: "POST", url: "/api/v1/sessions", headers: who.write, payload: { mode: "holdout", track_key: TRACK } });
}

async function learningOf(sessionId: string): Promise<HoldoutLearning> {
  const row = await iso.database.selectFrom("practice_session").select("state").where("id", "=", sessionId).executeTakeFirstOrThrow();
  const learning = persistedStateSchema.parse(row.state).learning;
  if (learning?.kind !== "holdout") {
    throw new Error(`session ${sessionId} is not a holdout session`);
  }
  return learning;
}

function next(sessionId: string, who: Player = player) {
  return app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: who.read });
}

function end(sessionId: string, who: Player = player) {
  return app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: who.write });
}

async function createdSession(who: Player = player): Promise<string> {
  const created = await createHoldout(who);
  expect(created.statusCode, created.body).toBe(201);
  return sessionSchema.parse(created.json()).session_id;
}

async function results(userId: string) {
  const rows = await iso.admin.query<{ holdout_item_id: string; outcome: string; attempt_id: string | null }>(
    "select holdout_item_id, outcome, attempt_id from holdout_result where user_id = $1 order by taken_at, holdout_item_id",
    [userId],
  );
  return rows.rows;
}

async function orderSeedOf(userId: string): Promise<string> {
  const rows = await iso.admin.query<{ order_seed: string }>("select order_seed from holdout_round where user_id = $1", [userId]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]?.order_seed ?? "";
}

function itemById(id: string | null): HoldoutItem {
  const found = items.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`no holdout item ${String(id)}`);
  }
  return found;
}

beforeAll(async () => {
  iso = await isolatedDatabase("r413_integrity");
  app = buildApp({ database: iso.database, config: TEST_CONFIG, solverQuery: fixtureSolverQuery(faultyFetch) });
  await app.ready();
  player = await newPlayer(iso.database);
  const catalog = await loadClassCatalog(fixtureSolverQuery(), iso.database);
  const classes = catalog.classes.filter((cls) => cls.trackKey === TRACK);
  const drawn = await drawTrackItems(classes, TRACK, DRAW_SEED, drawPort(fixtureSolverQuery(), "r4.13-integrity", LONG_TEST_MS));
  expect(drawn).toHaveLength(HOLDOUT_ITEMS_PER_TRACK);
  const track = await iso.database.selectFrom("track").select("id").where("key", "=", TRACK).executeTakeFirstOrThrow();
  await iso.database.transaction().execute((transaction) => recordDraw(transaction, track.id, DRAW_SEED, drawn));
  items = await holdoutItems(iso.database, TRACK);
}, LONG_TEST_MS);

afterAll(async () => {
  await app?.close();
  await iso?.drop();
});

describe("R4.13 holdout integrity (PR #27 review HIGH 1)", () => {
  const served: string[] = [];

  it(
    "R4.13 repeated create, view and end never serves an item twice: each served item is scored skipped",
    async () => {
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        const sessionId = await createdSession();
        const current = (await learningOf(sessionId)).current_item;
        const first = await next(sessionId);
        const again = await next(sessionId);
        expect(first.statusCode, first.body).toBe(200);
        expect(promptSchema.parse(again.json()).hero_hand).toEqual(promptSchema.parse(first.json()).hero_hand);
        served.push(itemById(current).id);
        const ended = await end(sessionId);
        expect(ended.statusCode, ended.body).toBe(200);
      }
      expect(new Set(served).size).toBe(REPEATS);
      const rows = await results(player.userId);
      expect(rows.map((row) => row.holdout_item_id).sort()).toEqual([...served].sort());
      expect(rows.every((row) => row.outcome === "skipped" && row.attempt_id === null)).toBe(true);
      const progress = await app.inject({ method: "GET", url: "/api/v1/progress/holdout", headers: player.read });
      const body = progress.json<{ open: { answered: number }; items: { tracks: { track_key: string; mean_score: number | null }[] }[] }>();
      expect(body.open.answered).toBe(REPEATS);
      expect(body.items[0]?.tracks.find((track) => track.track_key === TRACK)?.mean_score).toBe(0);
    },
    LONG_TEST_MS,
  );

  it("R4.13 the serving order is fixed per user and round by the round's stored order seed", async () => {
    const expected = sessionItems.roundOrder(items, await orderSeedOf(player.userId)).map((item) => item.id);
    expect(served).toEqual(expected.slice(0, REPEATS));
    const other = await newPlayer(iso.database);
    const otherSession = await createdSession(other);
    const otherOrder = sessionItems.roundOrder(items, await orderSeedOf(other.userId)).map((item) => item.id);
    expect((await learningOf(otherSession)).current_item).toBe(otherOrder[0]);
    expect(otherOrder).not.toEqual(expected);
    expect((await end(otherSession, other)).statusCode).toBe(200);
  });

  it(
    "R4.13 a new create replaces the open holdout session: it is ended, its item skipped, and the next item served",
    async () => {
      const firstId = await createdSession();
      const shown = (await learningOf(firstId)).current_item;
      expect((await next(firstId)).statusCode).toBe(200);
      const secondId = await createdSession();
      const replaced = await next(firstId);
      expect(replaced.statusCode, replaced.body).toBe(409);
      expect(replaced.json<{ type: string }>().type).toContain("session-ended");
      const open = await iso.admin.query("select id from practice_session where user_id = $1 and mode = 'holdout' and ended_at is null", [player.userId]);
      expect(open.rows).toEqual([{ id: secondId }]);
      const rows = await results(player.userId);
      expect(rows.find((row) => row.holdout_item_id === shown)).toMatchObject({ outcome: "skipped", attempt_id: null });
      const order = sessionItems.roundOrder(items, await orderSeedOf(player.userId)).map((item) => item.id);
      const resolved = new Set(rows.map((row) => row.holdout_item_id));
      expect((await learningOf(secondId)).current_item).toBe(order.find((id) => !resolved.has(id)));
      expect((await end(secondId)).statusCode).toBe(200);
    },
    LONG_TEST_MS,
  );
});

describe("R4.13 the next holdout item is prepared outside the decision transaction (PR #27 review HIGH 4, O-334)", () => {
  const DETERMINISTIC: DealFault = { kind: "status", status: DETERMINISTIC_STATUS };
  const TRANSIENT: DealFault = { kind: "status", status: TRANSIENT_STATUS };

  async function decideWithNextFaulted(fault: DealFault) {
    const sessionId = await createdSession();
    const learning = await learningOf(sessionId);
    const current = itemById(learning.current_item);
    const faulted = itemById(learning.remaining[0] ?? null);
    faults.set(faulted.dealSeed, fault);
    try {
      const prompt = promptSchema.parse((await next(sessionId)).json());
      const decision = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/decisions`,
        headers: player.write,
        payload: { state_version: prompt.state_version, action_index: 0, response_ms: RESPONSE_MS },
      });
      expect(decision.statusCode, decision.body).toBe(200);
    } finally {
      faults.delete(faulted.dealSeed);
    }
    return { sessionId, current, faulted, after: await learningOf(sessionId) };
  }

  /** A deterministic failure: the faulted item is unservable for the round and the session moves past it. */
  async function expectUnservable(fault: DealFault) {
    const { sessionId, current, faulted, after } = await decideWithNextFaulted(fault);
    const rows = await results(player.userId);
    expect(rows.find((row) => row.holdout_item_id === current.id)).toMatchObject({ outcome: "answered" });
    expect(rows.find((row) => row.holdout_item_id === faulted.id)).toMatchObject({ outcome: "unservable", attempt_id: null });
    expect(after.current_item).not.toBeNull();
    expect([current.id, faulted.id]).not.toContain(after.current_item);
    const served = await next(sessionId);
    expect(served.statusCode, served.body).toBe(200);
    expect(promptSchema.parse(served.json()).hero_position).toBe(itemById(after.current_item).heroPosition);
    expect((await end(sessionId)).statusCode).toBe(200);
  }

  /** A transient failure: the decision committed with no next item, the faulted item unresolved and served by the next create. */
  async function expectLeftUnresolved(fault: DealFault) {
    const { sessionId, current, faulted, after } = await decideWithNextFaulted(fault);
    const rows = await results(player.userId);
    expect(rows.find((row) => row.holdout_item_id === current.id)).toMatchObject({ outcome: "answered" });
    expect(rows.find((row) => row.holdout_item_id === faulted.id)).toBeUndefined();
    expect(after.current_item).toBeNull();
    expect(after.remaining[0]).toBe(faulted.id);
    const pending = await next(sessionId);
    expect(pending.statusCode, pending.body).toBe(503);
    const resumed = await createdSession();
    expect((await learningOf(resumed)).current_item).toBe(faulted.id);
    expect((await next(resumed)).statusCode).toBe(200);
    expect((await end(resumed)).statusCode).toBe(200);
  }

  it(
    "R4.13 O-334 a deterministic 4xx replay failure on the next item records it unservable for the round and the decision commits",
    async () => {
      await expectUnservable(DETERMINISTIC);
    },
    LONG_TEST_MS,
  );

  it(
    "R4.13 O-334 a deal that no longer matches the item records it unservable for the round",
    async () => {
      await expectUnservable({ kind: "mismatch" });
    },
    LONG_TEST_MS,
  );

  it(
    "R4.13 O-334 a transient 503 during the search leaves the item unresolved; the decision commits and the item is served next time",
    async () => {
      await expectLeftUnresolved(TRANSIENT);
    },
    LONG_TEST_MS,
  );

  it(
    "R4.13 O-334 a replay that outlives its per-call deadline is transient: the item stays unresolved and the decision still commits",
    async () => {
      await expectLeftUnresolved({ kind: "hang" });
    },
    HANG_TEST_MS,
  );

  it(
    "R4.13 O-334 a transient 503 during a create's search is a 503 that resolves nothing; the next create serves the item",
    async () => {
      const resolved = new Set((await results(player.userId)).map((row) => row.holdout_item_id));
      const order = sessionItems.roundOrder(items, await orderSeedOf(player.userId));
      const first = order.find((item) => !resolved.has(item.id));
      if (first === undefined) {
        throw new Error("the round has no unresolved item left for this test");
      }
      faults.set(first.dealSeed, TRANSIENT);
      try {
        const refused = await createHoldout();
        expect(refused.statusCode, refused.body).toBe(503);
      } finally {
        faults.delete(first.dealSeed);
      }
      expect((await results(player.userId)).find((row) => row.holdout_item_id === first.id)).toBeUndefined();
      const sessionId = await createdSession();
      expect((await learningOf(sessionId)).current_item).toBe(first.id);
      expect((await end(sessionId)).statusCode).toBe(200);
    },
    LONG_TEST_MS,
  );
});

describe("R4.13 the session-end tier reads the prepared catalog", () => {
  it("R4.13 an unseeded automated end with no prepared catalog is a 503 before any write", async () => {
    const now = new Date();
    const row: SessionRow = {
      id: randomUUID(),
      userId: player.userId,
      mode: "automated",
      drillId: null,
      settings: HOLDOUT_SETTINGS,
      state: initialState(DRAW_SEED, [{ config_id: "cfg_6_online_100", pair: "BB-BTN", line: null, hero_seat: "BTN", history: [] }], HOLDOUT_SESSION_SPOT, automatedLearning("preflop/class")),
      stateVersion: 1,
      startedAt: now,
      endedAt: now,
    };
    const context = {
      transaction: iso.database,
      now,
      timeZone: TEST_CONFIG.timeZone,
      userId: player.userId,
      session: row,
      ended: row,
      firstEnd: true,
      solverQuery: fixtureSolverQuery(),
      prepared: EMPTY_PREPARED_LEARNING,
    };
    await expect(HOLDOUT_HOOK_PART.onSessionEnd?.(context)).rejects.toMatchObject({ status: 503 });
    const unlocks = await iso.admin.query("select 1 from cosmetic_unlock where user_id = $1", [player.userId]);
    expect(unlocks.rows).toEqual([]);
  });
});

describe("R4.13 the draw job once every track is drawn (PR #27 review MEDIUM 9)", () => {
  const failingClient = () =>
    fixtureSolverQuery(() => Promise.reject(new Error("the draw must not call solver-query once every track is drawn")));

  async function scheduledDraws(): Promise<number> {
    const rows = await iso.admin.query("select id from app_job where kind = $1", [HOLDOUT_DRAW_KIND]);
    return rows.rows.length;
  }

  it("R4.13 while a track is undrawn the job is scheduled; once all are drawn it neither loads the catalog nor is scheduled", async () => {
    const now = new Date();
    await ensureScheduled(iso.database, [HOLDOUT_DRAW_JOB], now, TEST_CONFIG.timeZone);
    expect(await scheduledDraws()).toBe(1);
    await iso.admin.query("delete from app_job where kind = $1", [HOLDOUT_DRAW_KIND]);
    await iso.admin.query(
      "insert into holdout_draw (track_id, seed, items) select id, $1, 0 from track where id not in (select track_id from holdout_draw)",
      [DRAW_SEED],
    );
    const services = { solverQuery: failingClient(), learningHooks: NO_LEARNING_HOOKS, log: app.log };
    const report = await iso.database
      .transaction()
      .execute((transaction) => runHoldoutDraw({ transaction, job: job(HOLDOUT_DRAW_KIND, "2026-10-28"), now, services }));
    expect(report).toEqual({ recorded: [], short: [], uncovered: [] });
    await ensureScheduled(iso.database, [HOLDOUT_DRAW_JOB], now, TEST_CONFIG.timeZone);
    expect(await scheduledDraws()).toBe(0);
  });
});
