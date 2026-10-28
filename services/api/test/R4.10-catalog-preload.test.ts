/**
 * The class catalog is loaded before the decision transaction, never inside it (R4.10, O-270, O-272,
 * PR #27 review HIGH 3 and the catalog half of MEDIUM 12), over the test database and the fixture
 * solver-query behind a coverage control:
 * - a block's last hand commits while the catalog cannot load: the block closes (card and mastery
 *   written once) and the next block waits; GET /next answers the catalog's failure and writes
 *   nothing, then picks the next block once the catalog is back; a decision against the waiting
 *   state is a 409 stale-state; ending such a session never closes the block twice;
 * - a block-closing decision on a cold cache makes every coverage call before the lock and none
 *   between the first and the last hook of its transaction;
 * - the prepare runner turns a catalog failure into catalog null and runs each part's prepare.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { invalidateClassCatalogs } from "../src/automated/class-catalog.js";
import { REVIEW_BLOCK_INSTANCES } from "../src/automated/queue.js";
import type { Database } from "../src/db.js";
import { composeLearningHooks, EMPTY_PREPARED_LEARNING, NO_LEARNING_HOOKS, type LearningHookPart } from "../src/learning/effects.js";
import { LEARNING_HOOK_PARTS } from "../src/learning/hooks.js";
import { prepareLearning } from "../src/learning/prepare.js";
import { findSession, type SessionRow } from "../src/sessions/repository.js";
import {
  API,
  coverageControl,
  decideOnce,
  endSession,
  fullCatalogPairs,
  learningOfSession,
  requireAutomated,
  RESPONSE_MS,
  type CoverageControl,
} from "./R4.10-automated-kit.js";
import { newPlayer, type Player } from "./sessions-test-kit.js";
import { adminPool, appDatabase } from "./support/database.js";
import { buildTrainerApp, fixtureSolverQuery } from "./support/solver-query.js";

const OK = 200;
const CONFLICT = 409;
const SERVER_ERROR_FROM = 500;
/** Each test walks the all-configs catalog cold (hundreds of coverage calls), slow under a parallel suite. */
const COLD_CATALOG_TEST_TIMEOUT_MS = 120_000;

let database: Database;
let pool: pg.Pool;

beforeAll(() => {
  database = appDatabase();
  pool = adminPool();
});

afterAll(async () => {
  await pool.end();
  await database.destroy();
});

function controlledApp(control: CoverageControl, parts?: readonly LearningHookPart[]) {
  return buildTrainerApp(database, {
    solverQuery: fixtureSolverQuery(control.fetch),
    ...(parts === undefined ? {} : { learningHooks: composeLearningHooks(parts) }),
  });
}

type App = ReturnType<typeof controlledApp>;

async function cardRows(userId: string): Promise<string[]> {
  const cards = await pool.query<Record<string, unknown>>("select spot_class_key, fsrs_state, due from schedule_card where user_id = $1", [userId]);
  const mastery = await pool.query<Record<string, unknown>>("select spot_class_key, p_known from mastery where user_id = $1", [userId]);
  return [...cards.rows, ...mastery.rows].map((row) => JSON.stringify(row)).sort();
}

/** Creates an automated session, then plays its first block to the end while the catalog fails. */
async function closeBlockWithoutCatalog(app: App, control: CoverageControl, player: Player) {
  const session = await requireAutomated(app, player);
  invalidateClassCatalogs();
  control.failing = true;
  let last = await decideOnce(app, player, session.session_id);
  for (let hand = 1; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
    last = await decideOnce(app, player, session.session_id);
  }
  return { session, feedback: last.feedback };
}

describe("R4.10 a block closes while the catalog is unavailable (PR #27 review HIGH 3)", { timeout: COLD_CATALOG_TEST_TIMEOUT_MS }, () => {
  it("R4.10 the last hand commits, GET /next retries the pick without writing, and picks once the catalog is back", async () => {
    const control = coverageControl();
    const app = controlledApp(control);
    await app.ready();
    const player = await newPlayer(database);
    const { session, feedback } = await closeBlockWithoutCatalog(app, control, player);
    const first = session.automated!;
    expect(feedback.review_block).toMatchObject({ spot_class_key: first.spot_class_key, closed: true });
    const waiting = await learningOfSession(database, player.userId, session.session_id);
    expect(waiting.block).toMatchObject({ spot_class_key: first.spot_class_key, served: REVIEW_BLOCK_INSTANCES });
    const cards = await cardRows(player.userId);
    expect(cards.length).toBeGreaterThan(0);

    const unavailable = await app.inject({ method: "GET", url: `${API}/sessions/${session.session_id}/next`, headers: player.read });
    expect(unavailable.statusCode).toBeGreaterThanOrEqual(SERVER_ERROR_FROM);
    expect(await learningOfSession(database, player.userId, session.session_id)).toEqual(waiting);
    const stale = await app.inject({
      method: "POST",
      url: `${API}/sessions/${session.session_id}/decisions`,
      headers: player.write,
      payload: { state_version: feedback.state_version, action_index: 0, response_ms: RESPONSE_MS },
    });
    expect(stale.statusCode).toBe(CONFLICT);

    control.failing = false;
    const next = await app.inject({ method: "GET", url: `${API}/sessions/${session.session_id}/next`, headers: player.read });
    expect(next.statusCode).toBe(OK);
    const picked = await learningOfSession(database, player.userId, session.session_id);
    expect(picked.block.served).toBe(0);
    expect(picked.block.family).not.toBe(first.family);
    expect(picked.pick_no).toBe(waiting.pick_no + 1);
    expect(next.json<{ spot_class_key: string }>().spot_class_key).toBe(picked.block.spot_class_key);
    const again = await app.inject({ method: "GET", url: `${API}/sessions/${session.session_id}/next`, headers: player.read });
    expect(again.json()).toEqual(next.json());
    await decideOnce(app, player, session.session_id);
    expect(await cardRows(player.userId)).toEqual(cards);
    await app.close();
  });

  it("R4.10 ending a session whose closed block awaits its next pick closes nothing twice", async () => {
    const control = coverageControl();
    const app = controlledApp(control);
    await app.ready();
    const player = await newPlayer(database);
    const { session } = await closeBlockWithoutCatalog(app, control, player);
    const cards = await cardRows(player.userId);
    control.failing = false;
    const ended = await endSession(app, player, session.session_id);
    expect(ended.statusCode).toBe(OK);
    expect(await cardRows(player.userId)).toEqual(cards);
    await app.close();
  });
});

describe("R4.10 no catalog load inside the decision transaction (PR #27 review MEDIUM 12)", { timeout: COLD_CATALOG_TEST_TIMEOUT_MS }, () => {
  it("R4.10 a block-closing decision on a cold cache makes every coverage call before the lock and none inside", async () => {
    const control = coverageControl();
    const marks: number[] = [];
    const probe: LearningHookPart = {
      name: "probe",
      beforeGrade: () => {
        marks.push(control.calls());
        return Promise.resolve({});
      },
      afterInsert: () => {
        marks.push(control.calls());
        return Promise.resolve({});
      },
    };
    const app = controlledApp(control, [probe, ...LEARNING_HOOK_PARTS, probe]);
    await app.ready();
    const player = await newPlayer(database);
    const session = await requireAutomated(app, player);
    for (let hand = 1; hand < REVIEW_BLOCK_INSTANCES; hand += 1) {
      await decideOnce(app, player, session.session_id);
    }
    invalidateClassCatalogs();
    marks.length = 0;
    const before = control.calls();
    const { feedback } = await decideOnce(app, player, session.session_id);
    expect(feedback.review_block?.closed).toBe(true);
    const firstHook = marks[0] ?? Number.NaN;
    const lastHook = marks.at(-1) ?? Number.NaN;
    const insideTransaction = lastHook - firstHook;
    const beforeLock = firstHook - before;
    expect({ beforeLock, insideTransaction }).toEqual({ beforeLock: await fullCatalogPairs(database), insideTransaction: 0 });
    await app.close();
  });
});

describe("R4.10 the prepare runner (PR #27 review HIGH 3)", { timeout: COLD_CATALOG_TEST_TIMEOUT_MS }, () => {
  async function storedSession(app: App, player: Player): Promise<SessionRow> {
    const created = await requireAutomated(app, player);
    const row = await findSession(database, player.userId, created.session_id);
    if (row === undefined) {
      throw new Error("no session");
    }
    return row;
  }

  it("R4.10 a catalog that cannot load is prepared as null, never thrown, and each part's prepare lands under its name", async () => {
    const control = coverageControl();
    const app = controlledApp(control);
    await app.ready();
    const session = await storedSession(app, await newPlayer(database));
    invalidateClassCatalogs();
    control.failing = true;
    const warnings: unknown[] = [];
    const part: LearningHookPart = { name: "probe", needsCatalog: true, prepare: (context) => Promise.resolve({ sawCatalog: context.catalog !== null }) };
    const request = {
      database,
      solverQuery: fixtureSolverQuery(control.fetch),
      userId: session.userId,
      session,
      now: new Date(),
      log: { warn: (...args: unknown[]) => warnings.push(args) },
    };
    const failed = await prepareLearning(composeLearningHooks([part]), request);
    expect(failed).toEqual({ catalog: null, parts: { probe: { sawCatalog: false } } });
    expect(warnings).toHaveLength(1);
    control.failing = false;
    const loaded = await prepareLearning(composeLearningHooks([part]), request);
    expect(loaded.catalog?.classes.length).toBeGreaterThan(0);
    expect(loaded.parts).toEqual({ probe: { sawCatalog: true } });
    await app.close();
  });

  it("R4.10 hooks that need no catalog prepare none and ask solver-query nothing", async () => {
    const control = coverageControl();
    const app = controlledApp(control);
    await app.ready();
    const session = await storedSession(app, await newPlayer(database));
    invalidateClassCatalogs();
    const before = control.calls();
    const prepared = await prepareLearning(NO_LEARNING_HOOKS, {
      database,
      solverQuery: fixtureSolverQuery(control.fetch),
      userId: session.userId,
      session,
      now: new Date(),
      log: { warn: () => undefined },
    });
    expect(prepared).toEqual(EMPTY_PREPARED_LEARNING);
    expect(control.calls()).toBe(before);
    await app.close();
  });
});
