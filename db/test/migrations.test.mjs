// Migration tests (R0.6): dbmate reports nothing pending, every A4 table exists with the columns the
// O-IDs added, the enums, the queue index, the extension and the four group roles are present, and the
// same migrations apply cleanly to an empty database (A4 section 1).

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  A4_TABLES,
  GROUP_ROLES,
  createPool,
  listPublicTables,
  loadDatabaseUrl,
  runDbmate,
} from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

const EMPTY_DB_NAME = 'gto_empty_db_test';

describe('R0.6 migrations', () => {
  test('R0.6 dbmate status reports no pending migrations', () => {
    const output = runDbmate(['status']);
    assert.match(output, /Applied:\s+(\d+)/, `unexpected dbmate status output:\n${output}`);
    assert.match(output, /Pending:\s+0\b/, `pending migrations remain:\n${output}`);
    const applied = Number(output.match(/Applied:\s+(\d+)/)[1]);
    assert.ok(applied >= 11, `expected at least 11 applied migrations, got ${applied}`);
  });

  test('R0.6 every table from A4 section 2 exists in the public schema', async () => {
    const tables = await listPublicTables(pool);
    for (const table of A4_TABLES) {
      assert.ok(tables.includes(table), `missing table ${table}`);
    }
    assert.equal(A4_TABLES.length, 27, 'A4 lists 27 tables');
  });

  test('R0.6 the five enums carry the A4 values', async () => {
    const { rows } = await pool.query(
      `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
       from pg_type t join pg_enum e on e.enumtypid = t.oid
       group by t.typname order by t.typname`,
    );
    const enums = Object.fromEntries(rows.map((row) => [row.typname, row.labels]));
    assert.deepEqual(enums.game_format, ['online', 'live']);
    assert.deepEqual(enums.solution_source, ['own', 'reference']);
    assert.deepEqual(enums.solution_kind, ['preflop', 'flop_build']);
    assert.deepEqual(enums.job_status, ['queued', 'running', 'done', 'failed', 'blocked_budget']);
    assert.deepEqual(enums.practice_mode, [
      'automated',
      'drill',
      'holdout',
      'prediction',
      'range_paint',
    ]);
  });

  test('R0.6 uuid primary keys default to native uuidv7() (A4 section 1, Postgres 18)', async () => {
    const { rows } = await pool.query(
      `select table_name, column_default from information_schema.columns
       where table_schema = 'public' and column_name = 'id' and data_type = 'uuid'
       order by table_name`,
    );
    assert.ok(rows.length >= 10, 'expected uuid id columns');
    for (const row of rows) {
      assert.equal(row.column_default, 'uuidv7()', `${row.table_name}.id default`);
    }
    const version = await pool.query(`select current_setting('server_version_num')::int as num`);
    assert.ok(version.rows[0].num >= 180000, 'Postgres 18 or later');
  });

  test('R0.6 stake.note is nullable text (O-71) and game_config.ante_cbb defaults to 0 (O-33)', async () => {
    const { rows } = await pool.query(
      `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('stake', 'note'), ('game_config', 'ante_cbb'))
       order by table_name`,
    );
    assert.equal(rows.length, 2);
    const [ante, note] = rows;
    assert.equal(ante.table_name, 'game_config');
    assert.equal(ante.data_type, 'integer');
    assert.equal(ante.is_nullable, 'NO');
    assert.equal(ante.column_default, '0');
    assert.equal(note.table_name, 'stake');
    assert.equal(note.data_type, 'text');
    assert.equal(note.is_nullable, 'YES');
  });

  test('R0.6 build_job_queue is a partial index over queued rows by priority (A4 section 2)', async () => {
    const { rows } = await pool.query(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'build_job_queue'`,
    );
    assert.equal(rows.length, 1, 'build_job_queue index exists');
    assert.match(rows[0].indexdef, /\(priority DESC\)/);
    assert.match(rows[0].indexdef, /WHERE \(status = 'queued'::job_status\)/);
  });

  test('R0.6 pgcrypto is installed for digest() and the capture guard trigger exists', async () => {
    const ext = await pool.query(`select 1 from pg_extension where extname = 'pgcrypto'`);
    assert.equal(ext.rows.length, 1, 'pgcrypto extension');
    const trig = await pool.query(
      `select tgname, tgenabled from pg_trigger
       where tgrelid = 'solution'::regclass and tgname = 'solution_capture_source_guard'`,
    );
    assert.equal(trig.rows.length, 1, 'solution_capture_source_guard trigger');
    assert.equal(trig.rows[0].tgenabled, 'O', 'trigger enabled');
  });

  test('R0.6 the four group roles exist and cannot log in (O-28)', async () => {
    const { rows } = await pool.query(
      `select rolname, rolcanlogin, rolsuper from pg_roles where rolname = any($1) order by rolname`,
      [GROUP_ROLES],
    );
    assert.deepEqual(
      rows.map((row) => row.rolname),
      [...GROUP_ROLES].sort(),
    );
    for (const row of rows) {
      assert.equal(row.rolcanlogin, false, `${row.rolname} must be NOLOGIN`);
      assert.equal(row.rolsuper, false, `${row.rolname} must not be a superuser`);
    }
  });

  test('R0.6 public holds no privilege on any table or on the schema (A9 section 3)', async () => {
    const { rows } = await pool.query(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'PUBLIC'`,
    );
    assert.deepEqual(rows, [], 'no table grant to PUBLIC');
    // An aclitem for PUBLIC has an empty grantee, so it starts with "=" at the start or after a comma.
    // A null acl means the built-in defaults, which do include PUBLIC, so null fails too.
    const publicEntry = /(^\{|,)=/;
    const schema = await pool.query(`select nspacl::text as acl from pg_namespace where nspname = 'public'`);
    assert.ok(schema.rows[0].acl, 'schema public acl is explicit, not the default');
    assert.ok(!publicEntry.test(schema.rows[0].acl), `schema public acl still lists PUBLIC: ${schema.rows[0].acl}`);
    const database = await pool.query(
      `select datacl::text as acl from pg_database where datname = current_database()`,
    );
    assert.ok(database.rows[0].acl, 'database acl is explicit, not the default');
    assert.ok(!publicEntry.test(database.rows[0].acl), `database acl still lists PUBLIC: ${database.rows[0].acl}`);
  });

  test('R0.6 the migrations apply to an empty database and build the same tables', async () => {
    const scratchUrl = new URL(loadDatabaseUrl());
    scratchUrl.pathname = `/${EMPTY_DB_NAME}`;

    await pool.query(`drop database if exists ${EMPTY_DB_NAME} with (force)`);
    await pool.query(`create database ${EMPTY_DB_NAME}`);
    const scratch = new pg.Client({ connectionString: scratchUrl.toString() });
    try {
      const output = runDbmate(['--no-dump-schema', 'up'], { databaseUrl: scratchUrl.toString() });
      assert.match(output, /Appl(?:ying|ied): 20261020001100_seed_catalog\.sql/, output);

      await scratch.connect();
      const tables = await listPublicTables(scratch);
      for (const table of A4_TABLES) {
        assert.ok(tables.includes(table), `scratch database missing ${table}`);
      }
      const configs = await scratch.query('select count(*)::int as n from game_config');
      assert.equal(configs.rows[0].n, 11, 'seed applied in the scratch database');
    } finally {
      await scratch.end();
      await pool.query(`drop database if exists ${EMPTY_DB_NAME} with (force)`);
    }
  });
});
