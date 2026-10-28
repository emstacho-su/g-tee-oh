/**
 * Build queue fixtures for the coverage tests (R3.4, ADR 0018). The app role cannot insert a
 * build_job, so these rows go in through the superuser pool, the way the builder's planner would
 * write them, and every row a test inserts is deleted again by the same helper set.
 */
import type pg from "pg";

export const TEST_PREFLOP_LINES = "{srp}";
export const TEST_TREE_CONFIG_HASH = "\\x00";
export const TEST_K_RUNOUTS = 20;

export interface BuildJobFixture {
  configId: string;
  pair: string;
  flop: string;
  priority: number;
  status?: "queued" | "running" | "done" | "failed" | "blocked_budget";
  /** Bytea hex literal; two jobs for one spot need different hashes (the build_job key is unique). */
  treeConfigHash?: string;
}

export interface BuildJobRow {
  id: string;
  priority: number;
  status: string;
  locked_by: string | null;
}

export async function insertBuildJob(pool: pg.Pool, job: BuildJobFixture): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into build_job (game_config_id, position_pair, flop, preflop_lines, tree_config_hash, k_runouts, priority, status)
     values ($1, $2, $3, $4::text[], $5::bytea, $6, $7, $8::job_status) returning id`,
    [job.configId, job.pair, job.flop, TEST_PREFLOP_LINES, job.treeConfigHash ?? TEST_TREE_CONFIG_HASH, TEST_K_RUNOUTS, job.priority, job.status ?? "queued"],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("insert into build_job returned no id");
  }
  return row.id;
}

export async function readBuildJob(pool: pg.Pool, id: string): Promise<BuildJobRow> {
  const result = await pool.query<BuildJobRow>("select id, priority, status::text as status, locked_by from build_job where id = $1", [id]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`no build_job ${id}`);
  }
  return row;
}

export async function deleteBuildJobs(pool: pg.Pool, ids: readonly string[]): Promise<void> {
  await pool.query("delete from build_job where id = any($1::uuid[])", [ids]);
}

export interface LibrarySpot {
  configId: string;
  pair: string;
  flop: string;
}

/**
 * The solution or scenario rows for one configuration, pair and flop. A test that asserts no row
 * appeared counts only its own spot: other test files insert solution rows while vitest runs them
 * in parallel against the same database, so a table-wide count is not the test's to assert.
 */
export async function countSpotRows(pool: pg.Pool, table: "solution" | "scenario", spot: LibrarySpot): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*) as count from ${table} where game_config_id = $1 and position_pair = $2 and flop = $3`,
    [spot.configId, spot.pair, spot.flop],
  );
  return Number(result.rows[0]?.count ?? Number.NaN);
}

export async function countCoverageRequests(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>("select count(*) as count from coverage_request where user_id = $1", [userId]);
  return Number(result.rows[0]?.count ?? Number.NaN);
}

export interface RequestedSpot {
  userId: string;
  configId: string;
  pair: string;
  flop?: string;
  line?: string;
}

/** The coverage_request rows for one user and spot; an absent flop or line matches a null column. */
export async function countSpotRequests(pool: pg.Pool, spot: RequestedSpot): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*) as count from coverage_request
     where user_id = $1 and game_config_id = $2 and position_pair = $3
       and flop is not distinct from $4::text and line is not distinct from $5::text`,
    [spot.userId, spot.configId, spot.pair, spot.flop ?? null, spot.line ?? null],
  );
  return Number(result.rows[0]?.count ?? Number.NaN);
}
