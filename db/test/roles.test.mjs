// Role tests (R0.6, O-28): every probe runs as a group role through SET ROLE from the superuser
// connection, inside a transaction that rolls back, so the database is unchanged afterwards. query is
// select-only, app cannot see a schema named capture and may only bump build_job.priority, builder owns
// the library tables but no user tables, and capture inserts catalog rows and reference solutions only
// (A4 section 3, A9 section 3).

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CATALOG_TABLES,
  LIBRARY_TABLES,
  USER_TABLES,
  asRole,
  createPool,
  expectDenied,
  firstColumn,
  listPublicTables,
  withRollback,
} from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

const SEEDED_CONFIG = 'cfg_9_live_13_100';

/** Insert a build_job as the superuser and return its id; the caller's transaction rolls it back. */
async function insertBuildJob(client) {
  const { rows } = await client.query(
    `insert into build_job (game_config_id, position_pair, flop, preflop_lines, tree_config_hash, k_runouts, priority)
     values ($1, 'BTN_BB', 'AhKd2c', '{srp}', '\\x00', 20, 1.0) returning id`,
    [SEEDED_CONFIG],
  );
  return rows[0].id;
}

describe('R0.6 role query (read-only, O-28)', () => {
  test('R0.6 query cannot insert, update or delete on any table in public', async () => {
    await withRollback(pool, async (client) => {
      const tables = await listPublicTables(client);
      assert.ok(tables.length >= 27, 'tables present');
      for (const table of tables) {
        const column = await firstColumn(client, table);
        await expectDenied(client, 'query', `insert into "${table}" default values`);
        await expectDenied(client, 'query', `update "${table}" set "${column}" = default where false`);
        await expectDenied(client, 'query', `delete from "${table}" where false`);
      }
    });
  });

  test('R0.6 query selects catalog and library tables and nothing else', async () => {
    await withRollback(pool, async (client) => {
      for (const table of [...CATALOG_TABLES, ...LIBRARY_TABLES]) {
        await asRole(client, 'query', `select * from "${table}" limit 1`);
      }
      for (const table of USER_TABLES) {
        await expectDenied(client, 'query', `select * from "${table}" limit 1`);
      }
      await expectDenied(client, 'query', 'select * from schema_migrations limit 1');
    });
  });
});

describe('R0.6 role app (api)', () => {
  test('R0.6 app has no usage on a schema named capture (O-28)', async () => {
    await withRollback(pool, async (client) => {
      await client.query('create schema capture');
      const { rows } = await client.query(
        `select has_schema_privilege('app', 'capture', 'usage') as can_use,
                has_schema_privilege('app', 'capture', 'create') as can_create`,
      );
      assert.equal(rows[0].can_use, false, 'app must not have usage on capture');
      assert.equal(rows[0].can_create, false, 'app must not have create on capture');
      const asApp = await asRole(
        client,
        'app',
        `select has_schema_privilege('capture', 'usage') as usage`,
      );
      assert.equal(asApp.rows[0].usage, false, 'app sees no usage on capture under SET ROLE');
    });
  });

  test('R0.6 app cannot create objects in the public schema', async () => {
    await withRollback(pool, async (client) => {
      await expectDenied(client, 'app', 'create table app_scratch (id int)');
    });
  });

  test('R0.6 app can update build_job.priority but not status (A4 section 3)', async () => {
    await withRollback(pool, async (client) => {
      const id = await insertBuildJob(client);
      const bumped = await asRole(
        client,
        'app',
        'update build_job set priority = priority + 10 where id = $1 returning priority',
        [id],
      );
      assert.equal(bumped.rowCount, 1);
      assert.equal(Number(bumped.rows[0].priority), 11);
      await expectDenied(client, 'app', `update build_job set status = 'running' where id = $1`, [id]);
      await expectDenied(client, 'app', 'delete from build_job where id = $1', [id]);
      await expectDenied(
        client,
        'app',
        `insert into build_job (game_config_id, position_pair, flop, preflop_lines, tree_config_hash, k_runouts, priority)
         values ($1, 'CO_BB', 'AhKd2c', '{srp}', '\\x01', 20, 1.0)`,
        [SEEDED_CONFIG],
      );
    });
  });

  test('R0.6 app reads and writes user tables, reads catalog and library tables', async () => {
    await withRollback(pool, async (client) => {
      const user = await asRole(
        client,
        'app',
        `insert into app_user (email, password_hash) values ('role-test@example.invalid', 'argon2id$placeholder')
         returning id`,
      );
      const userId = user.rows[0].id;
      await asRole(client, 'app', `update app_user set email = 'role-test-2@example.invalid' where id = $1`, [
        userId,
      ]);
      await asRole(client, 'app', 'delete from app_user where id = $1', [userId]);
      for (const table of [...CATALOG_TABLES, ...LIBRARY_TABLES]) {
        await asRole(client, 'app', `select * from "${table}" limit 1`);
      }
      await expectDenied(client, 'app', `update stake set label = label where false`);
      await expectDenied(client, 'app', `insert into solution default values`);
      // O-88, O-241: app may upsert builder_setting overrides (S23) but never delete one.
      await expectDenied(client, 'app', `delete from builder_setting where false`);
    });
  });
});

describe('R0.6 role builder (library-builder)', () => {
  test('R0.6 builder writes library tables and reads the catalog, no user tables', async () => {
    await withRollback(pool, async (client) => {
      const inserted = await asRole(
        client,
        'builder',
        `insert into solution (kind, source, game_config_id, manifest_uri, status)
         values ('flop_build', 'own', $1, 's3://library/test/manifest.json', 'published') returning id`,
        [SEEDED_CONFIG],
      );
      await asRole(client, 'builder', `update solution set status = 'superseded' where id = $1`, [
        inserted.rows[0].id,
      ]);
      await asRole(client, 'builder', `delete from solution where id = $1`, [inserted.rows[0].id]);
      await asRole(client, 'builder', `insert into builder_setting (key, value) values ('k_runouts', '20')`);
      for (const table of CATALOG_TABLES) {
        await asRole(client, 'builder', `select * from "${table}" limit 1`);
      }
      await expectDenied(client, 'builder', `update stake set label = label where false`);
      for (const table of USER_TABLES) {
        await expectDenied(client, 'builder', `select * from "${table}" limit 1`);
      }
    });
  });
});

describe('R0.6 role capture (private repo, O-28)', () => {
  test('R0.6 capture inserts stake, sizing_convention, game_config and a reference solution', async () => {
    await withRollback(pool, async (client) => {
      const stakeId = randomUUID();
      const conventionId = randomUUID();
      const configId = 'cfg_test_capture';
      await asRole(
        client,
        'capture',
        `insert into stake (id, format, label, bb_cents, rake_percent_bp, rake_cap_cents, no_flop_no_drop)
         values ($1, 'live', 'capture-test', 1000, 1000, 500, true)`,
        [stakeId],
      );
      await asRole(
        client,
        'capture',
        `insert into sizing_convention (id, source, spec, spec_hash)
         values ($1, 'reference', $2::jsonb, digest($2::jsonb::text, 'sha256'))`,
        [conventionId, JSON.stringify({ open_bb: 2.5, capture_test: true })],
      );
      await asRole(
        client,
        'capture',
        `insert into game_config (id, format, table_size, stake_id, depth_cbb, straddle, sizing_convention_id)
         values ($1, 'live', 9, $2, 10000, false, $3)`,
        [configId, stakeId, conventionId],
      );
      await asRole(
        client,
        'capture',
        `insert into solution (id, kind, source, game_config_id, manifest_uri, status)
         values ($1, 'preflop', 'reference', $2, 's3://reference-private/test/manifest.json', 'published')`,
        [randomUUID(), configId],
      );
      const { rows } = await client.query(`select source from solution where game_config_id = $1`, [configId]);
      assert.deepEqual(rows, [{ source: 'reference' }]);
    });
  });

  test('R0.6 a solution insert with source own under capture raises', async () => {
    await withRollback(pool, async (client) => {
      const error = await expectDenied(
        client,
        'capture',
        `insert into solution (id, kind, source, game_config_id, manifest_uri, status)
         values ($1, 'flop_build', 'own', $2, 's3://library/test/manifest.json', 'published')`,
        [randomUUID(), SEEDED_CONFIG],
      );
      assert.match(error.message, /source reference only/);
    });
  });

  test('R0.6 the guard exempts the superuser, so builder-style own solutions still insert', async () => {
    await withRollback(pool, async (client) => {
      const { rowCount } = await client.query(
        `insert into solution (kind, source, game_config_id, manifest_uri, status)
         values ('flop_build', 'own', $1, 's3://library/test/manifest.json', 'published')`,
        [SEEDED_CONFIG],
      );
      assert.equal(rowCount, 1);
    });
  });

  test('R0.6 capture cannot select app_user or any other table, update or delete anything', async () => {
    await withRollback(pool, async (client) => {
      await expectDenied(client, 'capture', 'select * from app_user limit 1');
      for (const table of [...CATALOG_TABLES, ...LIBRARY_TABLES, ...USER_TABLES]) {
        await expectDenied(client, 'capture', `select * from "${table}" limit 1`);
      }
      await expectDenied(client, 'capture', `update stake set label = label where false`);
      await expectDenied(client, 'capture', `delete from solution where false`);
      await expectDenied(client, 'capture', `insert into build_job default values`);
      await expectDenied(client, 'capture', `insert into scenario default values`);
      await expectDenied(client, 'capture', `insert into app_user default values`);
    });
  });
});

describe('R3.4 to R3.7 api trainer tables (S23, O-240 to O-246)', () => {
  test('R3.5 app upserts builder_setting but cannot delete it or write other builder tables (O-88, O-241)', async () => {
    await withRollback(pool, async (client) => {
      await asRole(
        client,
        'app',
        `insert into builder_setting (key, value) values ('paused', 'true')
         on conflict (key) do update set value = excluded.value`,
      );
      await asRole(client, 'app', `update builder_setting set value = 'false' where key = 'paused'`);
      await expectDenied(client, 'app', `delete from builder_setting where false`);
      await expectDenied(client, 'app', `insert into storage_ledger (day, library_bytes, reference_bytes) values (current_date, 0, 0)`);
      await expectDenied(client, 'app', `update build_job set status = 'running' where false`);
    });
  });

  test('R3.4 app records coverage requests but never inserts a build_job (O-240, ADR 0018)', async () => {
    await withRollback(pool, async (client) => {
      const user = await client.query(
        `insert into app_user (email, password_hash) values ('coverage-role@example.invalid', 'x') returning id`,
      );
      await asRole(
        client,
        'app',
        `insert into coverage_request (user_id, game_config_id, position_pair) values ($1, $2, 'BB-BTN')`,
        [user.rows[0].id, SEEDED_CONFIG],
      );
      await asRole(client, 'app', 'select * from coverage_request limit 1');
      await asRole(client, 'builder', 'select * from coverage_request limit 1');
      await expectDenied(client, 'app', 'delete from coverage_request where false');
      await expectDenied(
        client,
        'app',
        `insert into build_job (game_config_id, position_pair, flop, preflop_lines, tree_config_hash, k_runouts, priority)
         values ($1, 'BB-BTN', 'AhKd2c', '{srp}', '\\x00', 20, 1.0)`,
        [SEEDED_CONFIG],
      );
    });
  });

  test('R3.5 app writes account email and password but can never set is_admin (O-242, PR #25 L1)', async () => {
    await withRollback(pool, async (client) => {
      const inserted = await asRole(
        client,
        'app',
        `insert into app_user (email, password_hash) values ('admin-flag@example.invalid', 'x') returning id, is_admin`,
      );
      assert.equal(inserted.rows[0].is_admin, false);
      const id = inserted.rows[0].id;
      await asRole(client, 'app', `update app_user set password_hash = 'y' where id = $1`, [id]);
      await expectDenied(client, 'app', `update app_user set is_admin = true where id = $1`, [id]);
      await expectDenied(
        client,
        'app',
        `insert into app_user (email, password_hash, is_admin) values ('self-admin@example.invalid', 'x', true)`,
      );
    });
  });

  test('R3.4 a user records one coverage request per spot (PR #25 M4)', async () => {
    await withRollback(pool, async (client) => {
      const user = await client.query(
        `insert into app_user (email, password_hash) values ('coverage-once@example.invalid', 'x') returning id`,
      );
      const insert = `insert into coverage_request (user_id, game_config_id, position_pair, flop)
        values ($1, $2, 'BB-BTN', null)
        on conflict (user_id, game_config_id, position_pair, coalesce(flop, ''), coalesce(line, '')) do nothing`;
      const first = await asRole(client, 'app', insert, [user.rows[0].id, SEEDED_CONFIG]);
      const second = await asRole(client, 'app', insert, [user.rows[0].id, SEEDED_CONFIG]);
      assert.deepEqual([first.rowCount, second.rowCount], [1, 0]);
    });
  });

  test('R3.7 an attempt is graded once per session version (O-246)', async () => {
    await withRollback(pool, async (client) => {
      const { rows } = await client.query(
        `select indexdef from pg_indexes where indexname = 'attempt_session_version_key'`,
      );
      assert.equal(rows.length, 1);
      assert.match(rows[0].indexdef, /UNIQUE INDEX .* \(session_id, state_version\) WHERE \(state_version IS NOT NULL\)/);
      const admin = await client.query(
        `select column_default, is_nullable from information_schema.columns
         where table_name = 'app_user' and column_name = 'is_admin'`,
      );
      assert.deepEqual(admin.rows, [{ column_default: 'false', is_nullable: 'NO' }]);
    });
  });
});

describe('R3.1 api tables (S21, O-230 to O-232)', () => {
  test('R3.1 app reads and writes idempotency_key; builder, capture and query cannot see it', async () => {
    await withRollback(pool, async (client) => {
      await asRole(client, 'app', 'select * from idempotency_key limit 1');
      await asRole(client, 'app', 'update idempotency_key set status_code = status_code where false');
      await asRole(client, 'app', 'delete from idempotency_key where false');
      for (const role of ['builder', 'capture', 'query']) {
        await expectDenied(client, role, 'select * from idempotency_key limit 1');
      }
    });
  });

  test('R3.1 auth_session stores a unique token hash and a csrf token, never null', async () => {
    await withRollback(pool, async (client) => {
      const { rows } = await client.query(
        `select column_name, is_nullable from information_schema.columns
         where table_name = 'auth_session' and column_name in ('token_hash', 'csrf_token')
         order by column_name`,
      );
      assert.deepEqual(rows, [
        { column_name: 'csrf_token', is_nullable: 'NO' },
        { column_name: 'token_hash', is_nullable: 'NO' },
      ]);
      const unique = await client.query(
        `select 1 from pg_constraint where conname = 'auth_session_token_hash_key' and contype = 'u'`,
      );
      assert.equal(unique.rowCount, 1);
    });
  });
});
