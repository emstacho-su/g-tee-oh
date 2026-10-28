/**
 * Shared setup of the session and grading route tests (R3.6, R3.7): a logged-in user with a drill,
 * a solution row the attempt foreign key needs (the app role cannot write the library, so the
 * superuser pool inserts it), the api over a solver-query client, and readers of the rows a test
 * compares before and after a request.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { buildApp, type ApiApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import type { DrillCreateBody, TrainerSettings } from "../src/schemas/drills.js";
import type { SolverQuery } from "../src/solver-query/client.js";
import { mutatingHeaders, readHeaders, TEST_CONFIG } from "./support/app.js";
import { createTestSession, createTestUser, type TestSession } from "./support/database.js";

export const TRAINER: TrainerSettings = {
  stop_rule: "end_of_hand",
  input: "actions",
  grouping: "standard",
  rng: false,
  pause: "never",
  speed: "normal",
  quick_result: false,
  tables: 1,
  timebank_s: null,
  panels: { hero_range_matrix: true },
};

export function drillBody(trainer: Partial<TrainerSettings> = {}, villains: DrillCreateBody["spot_filter"]["villain_positions"] = ["BB"]): DrillCreateBody {
  return {
    name: "BTN versus BB",
    tags: [],
    spot_filter: {
      game_config: { format: "online", table_size: 6, depths_bb: [100] },
      stake: "online",
      sizing: { mode: "convention" },
      start_street: "preflop",
      hero_positions: ["BTN"],
      villain_positions: villains,
      preflop_action: ["rfi"],
      hands: { mode: "all" },
      alternate_seats: false,
    },
    trainer: { ...TRAINER, ...trainer },
  };
}

export async function insertSolution(pool: pg.Pool, configId: string, pair: string, id: string = randomUUID()): Promise<string> {
  await pool.query(
    `insert into solution (id, kind, source, game_config_id, position_pair, manifest_uri, status)
     values ($1, 'preflop', 'reference', $2, $3, 's3://library/test/manifest.json', 'published')
     on conflict (id) do nothing`,
    [id, configId, pair],
  );
  return id;
}

export interface Player {
  userId: string;
  session: TestSession;
  read: Record<string, string>;
  write: Record<string, string>;
}

export async function newPlayer(database: Database): Promise<Player> {
  const user = await createTestUser(database);
  const session = await createTestSession(database, user.id);
  return { userId: user.id, session, read: readHeaders(session), write: mutatingHeaders(session) };
}

export function trainerApp(database: Database, solverQuery: SolverQuery): ApiApp {
  return buildApp({ database, config: TEST_CONFIG, solverQuery });
}

export async function createDrill(app: ApiApp, player: Player, body: DrillCreateBody): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/drills", headers: player.write, payload: body });
  if (response.statusCode !== 201) {
    throw new Error(`drill create failed: ${response.statusCode} ${response.body}`);
  }
  return response.json<{ id: string }>().id;
}

export async function startSession(app: ApiApp, player: Player, drillId: string, seed = "00000000deadbeef"): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    headers: player.write,
    payload: { mode: "drill", drill_id: drillId, seed },
  });
  if (response.statusCode !== 201) {
    throw new Error(`session create failed: ${response.statusCode} ${response.body}`);
  }
  return response.json<{ session_id: string }>().session_id;
}

export interface Rows {
  session: unknown[];
  attempts: unknown[];
}

/** The session row and its attempt rows as the database holds them. */
export async function rowsOf(pool: pg.Pool, sessionId: string): Promise<Rows> {
  const session = await pool.query("select * from practice_session where id = $1", [sessionId]);
  const attempts = await pool.query("select * from attempt where session_id = $1 order by id", [sessionId]);
  return { session: session.rows, attempts: attempts.rows };
}
