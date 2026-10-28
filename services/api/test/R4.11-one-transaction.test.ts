/**
 * Every learning write commits or rolls back with the decision or the end it belongs to (R4.11,
 * O-27, O-275). A failure is injected after each write of the two transactions, and each time the
 * user is left with no attempt, no session state change and no learning row:
 * - decision: after the attempt and the leak_stat write (a failing hook part after the shared one);
 *   at the leak_stat write itself (a failing statement: a trigger raising for this user only); after
 *   the review block close's schedule_card and mastery (a part that closes a block, then fails); and
 *   after the state write, at commit (a deferred constraint trigger on this session's row).
 * - end: after the rating period's rating and rating_history writes (a part that rates, then fails),
 *   and at the rating_history write itself (a failing statement).
 * Failures enter only through injected hook parts (buildApp's learningHooks) or statements the
 * superuser adds for one user or session and drops afterwards; no production code has a test switch.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { composeLearningHooks, type LearningHookPart } from "../src/learning/effects.js";
import { rateSessionTracks } from "../src/learning-state/rating-period.js";
import { closeReviewBlock } from "../src/learning-state/review-block.js";
import { createSharedEffectsPart } from "../src/learning-state/shared-effects.js";
import { TEST_CONFIG } from "./support/app.js";
import { adminPool, appDatabase } from "./support/database.js";
import { FAKE_CONFIG, FAKE_PAIR, fakeSolverQuery } from "./sessions-fake-solver-query.js";
import { createDrill, drillBody, insertSolution, newPlayer } from "./sessions-test-kit.js";
import { insertAttemptRow, learningRows, sessionAndAttempts, startUnseededSession, trackIds } from "./R4.11-learning-state-kit.js";

const SERVER_ERROR = 500;
const OK = 200;
const FOLD = 0;
const ROOT_CLASS = "preflop/online/100/rfi/BB-BTN";
const PRIOR_PER_1K = 25;

let database: Database;
let pool: pg.Pool;
let solutionId: string;
let tracks: Record<string, string>;

const sharedPart = createSharedEffectsPart({ frequencyPrior: () => Promise.resolve(PRIOR_PER_1K) });
const failAfter = (name: string): LearningHookPart => ({
  name,
  afterInsert: () => Promise.reject(new Error(`injected after ${name}`)),
});

beforeAll(async () => {
  database = appDatabase();
  pool = adminPool();
  solutionId = await insertSolution(pool, FAKE_CONFIG, FAKE_PAIR);
  tracks = await trackIds(pool);
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

async function setUp(parts: readonly LearningHookPart[]) {
  const app = buildApp({
    database,
    config: TEST_CONFIG,
    solverQuery: fakeSolverQuery({ solutionId }).client,
    learningHooks: composeLearningHooks(parts),
  });
  await app.ready();
  const player = await newPlayer(database);
  // Unseeded: a client-seeded session writes no learning state (PR #27 review HIGH 2).
  const sessionId = await startUnseededSession(app, player, await createDrill(app, player, drillBody()));
  const snapshot = async () => ({ ...(await sessionAndAttempts(pool, player.userId)), learning: await learningRows(pool, player.userId) });
  return { app, player, sessionId, snapshot };
}

type Setup = Awaited<ReturnType<typeof setUp>>;

function decide({ app, player, sessionId }: Setup) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/decisions`,
    headers: player.write,
    payload: { state_version: 0, action_index: FOLD, response_ms: 900 },
  });
}

function end({ app, player, sessionId }: Setup) {
  return app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/end`, headers: player.write });
}

/** Runs `body` with a superuser-made failing statement in place, and always drops it. */
async function withFailingStatement(create: (name: string) => string, drop: (name: string) => string, body: () => Promise<void>): Promise<void> {
  const name = `r411_fail_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`create function ${name}() returns trigger language plpgsql as $$ begin raise exception 'injected ${name}'; end $$`);
  await pool.query(create(name));
  try {
    await body();
  } finally {
    await pool.query(drop(name));
    await pool.query(`drop function ${name}()`);
  }
}

describe("R4.11 the decision transaction holds every learning write", () => {
  it("R4.11 the control: with the shared part alone the decision writes its attempt, state and leak_stat", async () => {
    const setup = await setUp([sharedPart]);
    const before = await setup.snapshot();
    expect((await decide(setup)).statusCode).toBe(OK);
    const after = await setup.snapshot();
    expect(after.attempts).toHaveLength(1);
    expect(after.sessions).not.toEqual(before.sessions);
    expect(after.learning.leak_stat).toHaveLength(1);
    await setup.app.close();
  });

  it("R4.11 a failure after the attempt and leak_stat writes leaves no attempt, no state change and no leak_stat", async () => {
    const setup = await setUp([sharedPart, failAfter("leak-stat")]);
    const before = await setup.snapshot();
    expect((await decide(setup)).statusCode).toBe(SERVER_ERROR);
    expect(await setup.snapshot()).toEqual(before);
    await setup.app.close();
  });

  it("R4.11 a failing leak_stat statement leaves no attempt and no state change", async () => {
    const setup = await setUp([sharedPart]);
    const before = await setup.snapshot();
    await withFailingStatement(
      (name) => `create trigger ${name} before insert or update on leak_stat for each row when (new.user_id = '${setup.player.userId}') execute function ${name}()`,
      (name) => `drop trigger ${name} on leak_stat`,
      async () => {
        expect((await decide(setup)).statusCode).toBe(SERVER_ERROR);
      },
    );
    expect(await setup.snapshot()).toEqual(before);
    await setup.app.close();
  });

  it("R4.11 a failure after the block close's schedule_card and mastery writes leaves none of them", async () => {
    const closesBlock: LearningHookPart = {
      name: "closes-block",
      afterInsert: async ({ transaction, userId, now }) => {
        await closeReviewBlock(transaction, { userId, spotClassKey: ROOT_CLASS, workedExample: false, attempts: [{ score: 1, responseMs: 900, label: "best" }], now });
        return {};
      },
    };
    const setup = await setUp([sharedPart, closesBlock, failAfter("block-close")]);
    const before = await setup.snapshot();
    expect((await decide(setup)).statusCode).toBe(SERVER_ERROR);
    expect(await setup.snapshot()).toEqual(before);
    await setup.app.close();
  });

  it("R4.11 a failure at commit, after the state write, leaves no attempt, no state change and no learning row", async () => {
    const closesBlock: LearningHookPart = {
      name: "closes-block",
      afterInsert: async ({ transaction, userId, now }) => {
        await closeReviewBlock(transaction, { userId, spotClassKey: ROOT_CLASS, workedExample: true, attempts: [], now });
        return {};
      },
    };
    const setup = await setUp([sharedPart, closesBlock]);
    const before = await setup.snapshot();
    await withFailingStatement(
      (name) =>
        `create constraint trigger ${name} after update on practice_session deferrable initially deferred for each row when (new.id = '${setup.sessionId}') execute function ${name}()`,
      (name) => `drop trigger ${name} on practice_session`,
      async () => {
        expect((await decide(setup)).statusCode).toBe(SERVER_ERROR);
      },
    );
    expect(await setup.snapshot()).toEqual(before);
    await setup.app.close();
  });
});

describe("R4.11 the end transaction holds the rating period", () => {
  const rates: LearningHookPart = {
    name: "rates",
    onSessionEnd: async ({ transaction, userId, session, now }) => ({
      rating_changes: await rateSessionTracks(transaction, { userId, sessionId: session.id, now }),
    }),
  };

  async function withRatedAttempt(parts: readonly LearningHookPart[]) {
    const setup = await setUp(parts);
    await insertAttemptRow(pool, {
      userId: setup.player.userId,
      sessionId: setup.sessionId,
      solutionId,
      spotClassKey: ROOT_CLASS,
      rated: true,
      itemDifficulty: 1500,
      trackIds: [tracks.opens ?? ""],
    });
    return setup;
  }

  it("R4.11 the control: the end rates the session's track", async () => {
    const setup = await withRatedAttempt([rates]);
    expect((await end(setup)).statusCode).toBe(OK);
    const after = await setup.snapshot();
    expect(after.learning.rating).toHaveLength(1);
    expect(after.learning.rating_history).toHaveLength(1);
    await setup.app.close();
  });

  it("R4.11 a failure after the rating writes leaves the session open and no rating row", async () => {
    const failsAfterRating: LearningHookPart = { name: "fails", onSessionEnd: () => Promise.reject(new Error("injected after rating")) };
    const setup = await withRatedAttempt([rates, failsAfterRating]);
    const before = await setup.snapshot();
    expect((await end(setup)).statusCode).toBe(SERVER_ERROR);
    expect(await setup.snapshot()).toEqual(before);
    await setup.app.close();
  });

  it("R4.11 a failing rating_history statement leaves the session open and no rating row", async () => {
    const setup = await withRatedAttempt([rates]);
    const before = await setup.snapshot();
    await withFailingStatement(
      (name) => `create trigger ${name} before insert on rating_history for each row when (new.user_id = '${setup.player.userId}') execute function ${name}()`,
      (name) => `drop trigger ${name} on rating_history`,
      async () => {
        expect((await end(setup)).statusCode).toBe(SERVER_ERROR);
      },
    );
    expect(await setup.snapshot()).toEqual(before);
    await setup.app.close();
  });
});
