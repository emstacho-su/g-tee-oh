/**
 * Holdout end to end (R4.13, O-100, O-276, O-277, the PM seed condition) on a database of its own
 * (R4.13-isolated-database.ts: drawn items are global and would hold hands back in other files),
 * against the fixture solver-query:
 * - before any draw a holdout session is 422 no-holdout-items, and a body with a seed is 400;
 * - the draw job records 30 distinct items per covered track from a stored seed, the same seed draws
 *   the same items again, and a second run never redraws;
 * - a holdout session replays each item's stored deal exactly, grades it unrated, writes its
 *   holdout_result with the round and no learning state, and once every item of the track is
 *   answered GET /next and a new session are 409 holdout-complete;
 * - the monthly job closes the round with per-track summaries and opens the next month, and a
 *   second run changes nothing; the guard holds back every stored item.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp, type ApiApp } from "../src/app.js";
import { loadClassCatalog } from "../src/automated/class-catalog.js";
import { drawPort } from "../src/holdout/draw-port.js";
import { drawTrackItems, HOLDOUT_ITEMS_PER_TRACK } from "../src/holdout/draw.js";
import { loadHoldoutGuard } from "../src/holdout/guard.js";
import { holdoutItems, type HoldoutItem } from "../src/holdout/repository.js";
import { roundOrder } from "../src/holdout/session-items.js";
import { HOLDOUT_DRAW_KIND, runHoldoutDraw, type DrawReport } from "../src/jobs/holdout-draw.js";
import { HOLDOUT_ROUND_KIND, runHoldoutRounds } from "../src/jobs/holdout-round.js";
import type { ClaimedJob } from "../src/jobs/repository.js";
import { NO_LEARNING_HOOKS } from "../src/learning/effects.js";
import { feedbackSchema, promptSchema, sessionSchema } from "../src/schemas/training.js";
import { persistedStateSchema } from "../src/sessions/state.js";
import { monthOf, nextMonth } from "../src/streaks/calendar.js";
import { TEST_CONFIG } from "./support/app.js";
import { fixtureSolverQuery } from "./support/solver-query.js";
import { isolatedDatabase, type IsolatedDatabase } from "./R4.13-isolated-database.js";
import { newPlayer, type Player } from "./sessions-test-kit.js";

const TRACK = "opens";
const LONG_TEST_MS = 600_000;
const RESPONSE_MS = 1500;
/** This month's round in the earlier-round test: a known order seed, so the test knows its first item. */
const KNOWN_ORDER_SEED = "0123456789abcdef";
const LEARNING_TABLES = ["leak_stat", "schedule_card", "mastery", "rating", "rating_history", "streak_day", "cosmetic_unlock"] as const;

let iso: IsolatedDatabase;
let app: ApiApp;
let player: Player;
let report: DrawReport;

function job(kind: string, periodKey: string): ClaimedJob {
  const now = new Date();
  return { id: randomUUID(), kind, periodKey, runAt: now, attempts: 1, lockedBy: "r4.13-test", lockedAt: now };
}

function seeds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return next.toString(16).padStart(16, "0");
  };
}

async function draw(newSeed: () => string): Promise<DrawReport> {
  const services = { solverQuery: fixtureSolverQuery(), learningHooks: NO_LEARNING_HOOKS, log: app.log };
  return iso.database
    .transaction()
    .execute((transaction) => runHoldoutDraw({ transaction, job: job(HOLDOUT_DRAW_KIND, "2026-10-27"), now: new Date(), services }, newSeed));
}

function createHoldout(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/v1/sessions", headers: player.write, payload: { mode: "holdout", ...payload } });
}

async function stateOf(sessionId: string) {
  const row = await iso.database.selectFrom("practice_session").select("state").where("id", "=", sessionId).executeTakeFirstOrThrow();
  return persistedStateSchema.parse(row.state);
}

async function countRows(table: string, userId: string): Promise<number> {
  const result = await iso.admin.query<{ n: string }>(`select count(*) as n from ${table} where user_id = $1`, [userId]);
  return Number(result.rows[0]?.n);
}

async function decide(sessionId: string) {
  const next = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
  expect(next.statusCode, next.body).toBe(200);
  const prompt = promptSchema.parse(next.json());
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: prompt.state_version, action_index: 0, response_ms: RESPONSE_MS },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { prompt, feedback: feedbackSchema.parse(response.json()) };
}

beforeAll(async () => {
  iso = await isolatedDatabase("r413_holdout");
  app = buildApp({ database: iso.database, config: TEST_CONFIG, solverQuery: fixtureSolverQuery() });
  await app.ready();
  player = await newPlayer(iso.database);
}, LONG_TEST_MS);

afterAll(async () => {
  await app?.close();
  await iso?.drop();
});

describe("R4.13 holdout sessions before the draw", () => {
  it("R4.13 a holdout body with a seed is 400 and never creates a session (PM seed condition)", async () => {
    const response = await createHoldout({ seed: "00000000deadbeef" });
    expect(response.statusCode, response.body).toBe(400);
    expect(await countRows("practice_session", player.userId)).toBe(0);
  });

  it("R4.13 with no drawn item a holdout session is 422 no-holdout-items", async () => {
    const response = await createHoldout({});
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json<{ type: string }>().type).toContain("no-holdout-items");
  });
});

describe("R4.13 the holdout draw", () => {
  it(
    "R4.13 the job records 30 distinct items per covered track; the stored seed redraws them; a second run never redraws",
    async () => {
      report = await draw(seeds());
      expect(report.recorded).toContain(TRACK);
      expect(report.short).toEqual([]);
      const draws = await iso.database.selectFrom("holdout_draw").innerJoin("track", "track.id", "holdout_draw.track_id").select(["track.key", "seed", "items"]).execute();
      expect(draws.map((row) => row.key).sort()).toEqual([...report.recorded].sort());
      const catalog = await loadClassCatalog(fixtureSolverQuery(), iso.database);
      for (const row of draws) {
        const stored = await holdoutItems(iso.database, row.key as typeof TRACK);
        expect(stored, row.key).toHaveLength(HOLDOUT_ITEMS_PER_TRACK);
        expect(row.items).toBe(HOLDOUT_ITEMS_PER_TRACK);
        expect(new Set(stored.map((item) => `${item.solutionId}|${item.nodeKey}|${item.hand}`)).size).toBe(HOLDOUT_ITEMS_PER_TRACK);
        const classes = catalog.classes.filter((cls) => cls.trackKey === row.key);
        const redrawn = await drawTrackItems(classes, row.key as typeof TRACK, row.seed, drawPort(fixtureSolverQuery(), "r4.13-redraw", LONG_TEST_MS));
        const key = (item: Omit<HoldoutItem, "id">) => [item.spotClassKey, item.configId, item.pair, item.line, item.dealSeed, item.nodeKey, item.hand].join("|");
        expect(redrawn.map(key).sort()).toEqual(stored.map(key).sort());
      }
      const second = await draw(seeds());
      expect(second.recorded).toEqual([]);
      const total = await iso.admin.query<{ n: string }>("select count(*) as n from holdout_item");
      expect(Number(total.rows[0]?.n)).toBe(HOLDOUT_ITEMS_PER_TRACK * draws.length);
    },
    LONG_TEST_MS,
  );

  it("R4.13 the guard holds back every stored item and nothing else", async () => {
    const guard = await loadHoldoutGuard(iso.database);
    const items = await holdoutItems(iso.database);
    expect(items.every((item) => guard.isHeldOut(item.solutionId, item.nodeKey, item.hand))).toBe(true);
    expect(guard.isHeldOut(randomUUID(), "root", "AA")).toBe(false);
  });
});

describe("R4.13 holdout retest sessions", () => {
  let sessionId: string;

  it(
    "R4.13 a holdout session replays its item's stored deal: the identical hand at the item's node",
    async () => {
      const created = await createHoldout({ track_key: TRACK });
      expect(created.statusCode, created.body).toBe(201);
      const session = sessionSchema.parse(created.json());
      sessionId = session.session_id;
      expect(session).toMatchObject({ mode: "holdout", rated_eligible: false, automated: null });
      expect(session.holdout).toMatchObject({ answered: 0, total: HOLDOUT_ITEMS_PER_TRACK });
      const learning = (await stateOf(sessionId)).learning;
      const itemId = learning?.kind === "holdout" ? learning.current_item : null;
      const item = (await holdoutItems(iso.database, TRACK)).find((candidate) => candidate.id === itemId);
      expect(item).toBeDefined();
      const deal = await drawPort(fixtureSolverQuery(), "r4.13-replay", LONG_TEST_MS).deal(
        { configId: item?.configId ?? "", pair: item?.pair ?? "", line: item?.line ?? null },
        item?.dealSeed ?? "",
      );
      const { prompt, feedback } = await decide(sessionId);
      expect(prompt.hero_hand.join("")).toBe(deal.hero_hand);
      expect(prompt.hero_position).toBe(item?.heroPosition);
      expect(feedback).toMatchObject({ solution_id: item?.solutionId, node_key: item?.nodeKey, hand: deal.hero_hand });
      const attempt = await iso.database.selectFrom("attempt").select(["hand_class"]).where("id", "=", feedback.attempt_id).executeTakeFirstOrThrow();
      expect(attempt.hand_class).toBe(item?.hand);
    },
    LONG_TEST_MS,
  );

  it("R4.13 retest decisions are unrated, record holdout_result with the round, and write no learning state", async () => {
    const learning = (await stateOf(sessionId)).learning;
    const roundId = learning?.kind === "holdout" ? learning.round_id : "";
    expect(learning).toMatchObject({ kind: "holdout", answered: 1 });
    const results = await iso.admin.query("select round_id, attempt_id from holdout_result where user_id = $1", [player.userId]);
    expect(results.rows).toHaveLength(1);
    expect(results.rows[0]).toMatchObject({ round_id: roundId });
    const rated = await iso.admin.query<{ n: string }>("select count(*) filter (where rated) as n from attempt where user_id = $1", [player.userId]);
    expect(Number(rated.rows[0]?.n)).toBe(0);
    for (const table of LEARNING_TABLES) {
      expect(await countRows(table, player.userId), table).toBe(0);
    }
    const round = await iso.admin.query<{ month: string }>("select to_char(month, 'YYYY-MM-DD') as month from holdout_round where id = $1", [roundId]);
    expect(round.rows[0]?.month).toBe(monthOf(new Date().toISOString().slice(0, 10)));
  });

  it(
    "R4.13 once every item of the track is answered, GET /next and a new session are 409 holdout-complete",
    async () => {
      for (let answered = 1; answered < HOLDOUT_ITEMS_PER_TRACK; answered += 1) {
        const { feedback } = await decide(sessionId);
        expect(feedback.rated).toBe(false);
      }
      const results = await iso.admin.query<{ n: string }>("select count(distinct holdout_item_id) as n from holdout_result where user_id = $1", [player.userId]);
      expect(Number(results.rows[0]?.n)).toBe(HOLDOUT_ITEMS_PER_TRACK);
      const next = await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/next`, headers: player.read });
      expect(next.statusCode, next.body).toBe(409);
      expect(next.json<{ type: string }>().type).toContain("holdout-complete");
      const again = await createHoldout({ track_key: TRACK });
      expect(again.statusCode, again.body).toBe(409);
      for (const table of LEARNING_TABLES) {
        expect(await countRows(table, player.userId), table).toBe(0);
      }
    },
    LONG_TEST_MS,
  );
});

describe("R4.13 the monthly round job", () => {
  it("R4.13 closes the open round with per-track summaries, opens the next month, and a second run changes nothing", async () => {
    const thisMonth = monthOf(new Date().toISOString().slice(0, 10));
    const period = nextMonth(thisMonth);
    const run = () =>
      iso.database.transaction().execute((transaction) => runHoldoutRounds({ transaction, job: job(HOLDOUT_ROUND_KIND, period), now: new Date() }));
    const snapshot = async () => ({
      rounds: (await iso.admin.query<{ month: string; closed: boolean }>("select to_char(month, 'YYYY-MM-DD') as month, closed_at is not null as closed from holdout_round where user_id = $1 order by month", [player.userId])).rows,
      summaries: (
        await iso.admin.query<{ key: string; answered: number; total: number; mean_score: number | null; goodhart_flag: boolean }>(
          "select t.key, s.answered, s.total, s.mean_score, s.goodhart_flag from holdout_summary s join track t on t.id = s.track_id join holdout_round r on r.id = s.round_id where r.user_id = $1 order by t.key",
          [player.userId],
        )
      ).rows,
    });
    await run();
    const first = await snapshot();
    expect(first.rounds).toEqual([
      { month: thisMonth, closed: true },
      { month: period, closed: false },
    ]);
    const opens = first.summaries.find((row) => row.key === TRACK);
    expect(opens).toMatchObject({ answered: HOLDOUT_ITEMS_PER_TRACK, total: HOLDOUT_ITEMS_PER_TRACK, goodhart_flag: false });
    expect(first.summaries).toHaveLength(report.recorded.length);
    await run();
    expect(await snapshot()).toEqual(first);
  });

  it("R4.13 GET /progress/holdout lists the closed round's summaries and the open round", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/progress/holdout", headers: player.read });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ items: { round_month: string; closed_at: string | null; tracks: { track_key: string; answered: number }[] }[]; open: unknown }>();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.closed_at).toBeNull();
    expect(body.items[1]?.tracks.find((track) => track.track_key === TRACK)?.answered).toBe(HOLDOUT_ITEMS_PER_TRACK);
    expect(body.open).toMatchObject({ answered: 0 });
  });
});

describe("R4.13 an open holdout session of an earlier round (PR #27 review follow-up LOW 2)", () => {
  it(
    "R4.13 last month's open session does not hold back this round's first item: the create serves it and ends the old session",
    async () => {
      const other = await newPlayer(iso.database);
      const create = () => app.inject({ method: "POST", url: "/api/v1/sessions", headers: other.write, payload: { mode: "holdout", track_key: TRACK } });
      const opened = await create();
      expect(opened.statusCode, opened.body).toBe(201);
      const oldSession = sessionSchema.parse(opened.json()).session_id;
      // The open session's round becomes last month's; this month's round opens with a known order seed.
      const moved = await iso.admin.query<{ month: string }>(
        "update holdout_round set month = (month - interval '1 month')::date where user_id = $1 returning to_char(month + interval '1 month', 'YYYY-MM-DD') as month",
        [other.userId],
      );
      await iso.admin.query("insert into holdout_round (user_id, month, order_seed) values ($1, $2::date, $3)", [other.userId, moved.rows[0]?.month, KNOWN_ORDER_SEED]);
      const firstItem = roundOrder(await holdoutItems(iso.database, TRACK), KNOWN_ORDER_SEED)[0];
      // Last month's open session serves exactly this round's first item.
      await iso.admin.query("update practice_session set state = jsonb_set(state, '{learning,current_item}', to_jsonb($2::text)) where id = $1", [
        oldSession,
        firstItem?.id,
      ]);
      const created = await create();
      expect(created.statusCode, created.body).toBe(201);
      const newSession = sessionSchema.parse(created.json()).session_id;
      expect((await stateOf(newSession)).learning).toMatchObject({ kind: "holdout", current_item: firstItem?.id });
      const ended = await iso.admin.query<{ ended_at: Date | null }>("select ended_at from practice_session where id = $1", [oldSession]);
      expect(ended.rows[0]?.ended_at).not.toBeNull();
      expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${newSession}/end`, headers: other.write })).statusCode).toBe(200);
    },
    LONG_TEST_MS,
  );
});
