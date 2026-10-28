// The hand log table (R3.13, S40, O-352, O-400 to O-402): hand_record is append-only for app and
// invisible to the other roles, a row can only name a session of its own user (the composite key on
// practice_session (id, user_id)), one row per (session, hand) and per ending attempt, the end reason
// and shape checks hold, and the migration's down section removes the table and the practice_session
// key again. Every probe runs inside a transaction that rolls back, so the database is unchanged.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR, asRole, createPool, expectDenied, withRollback } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

const MIGRATION_FILE = '20261030000500_hand_record.sql';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** Two users, a session of the first and an attempt in it; the caller's transaction rolls them back. */
async function handFixture(client) {
  const owner = await client.query(
    `insert into app_user (email, password_hash) values ('hand-owner@example.invalid', 'x') returning id`,
  );
  const other = await client.query(
    `insert into app_user (email, password_hash) values ('hand-other@example.invalid', 'x') returning id`,
  );
  const solution = await client.query(
    `insert into solution (kind, source, game_config_id, position_pair, manifest_uri, status)
     values ('preflop', 'own', 'cfg_6_online_100', 'BB-BTN', 'memory://hand-record-probe', 'published') returning id`,
  );
  const ownerId = owner.rows[0].id;
  const session = await client.query(
    `insert into practice_session (user_id, mode, settings, state) values ($1, 'drill', '{}', '{}') returning id`,
    [ownerId],
  );
  const sessionId = session.rows[0].id;
  const attempt = await insertAttempt(client, ownerId, sessionId, solution.rows[0].id);
  return { ownerId, otherId: other.rows[0].id, sessionId, solutionId: solution.rows[0].id, attemptId: attempt };
}

async function insertAttempt(client, userId, sessionId, solutionId) {
  const { rows } = await client.query(
    `insert into attempt (user_id, session_id, solution_id, node_key, spot_class_key, track_ids, hand, action_index,
       action_token, ev_chosen_bb, ev_best_bb, ev_loss_bb, ev_loss_pct_pot, floor_pct_pot, score, label, rated, weight)
     values ($1, $2, $3, 'root', 'preflop/rfi', '{}', 'AhKd', 1, 'r250', 1, 1, 0, 0, 0.1, 1, 'best', false, 0)
     returning id`,
    [userId, sessionId, solutionId],
  );
  return rows[0].id;
}

const INSERT_RECORD = `insert into hand_record (user_id, session_id, attempt_id, hand_no, hero_position, hero_hand, history, board, end_reason)
  values ($1, $2, $3, $4, 'BTN', 'AhKd', '[{"position":"BTN","token":"r250","label":"Raise to 2.5bb","street":"preflop"}]', $5, $6)
  returning id`;

function recordParams(fixture, overrides = {}) {
  const values = { userId: fixture.ownerId, sessionId: fixture.sessionId, attemptId: fixture.attemptId, handNo: 0, board: [], end: 'stop_rule', ...overrides };
  return [values.userId, values.sessionId, values.attemptId, values.handNo, values.board, values.end];
}

async function expectCode(client, sql, params, code) {
  await client.query('savepoint probe');
  let error;
  try {
    await client.query(sql, params);
  } catch (err) {
    error = err;
  }
  await client.query('rollback to savepoint probe');
  assert.ok(error, `expected SQLSTATE ${code}: ${sql}`);
  assert.equal(error.code, code, `expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
}

describe('R3.13 hand_record (S40, O-352, O-400 to O-402)', () => {
  test('R3.13 app inserts and reads hand_record but cannot change or delete it; builder, capture and query cannot see it', async () => {
    await withRollback(pool, async (client) => {
      const fixture = await handFixture(client);
      const inserted = await asRole(client, 'app', INSERT_RECORD, recordParams(fixture));
      assert.equal(inserted.rows.length, 1);
      const read = await asRole(client, 'app', 'select end_reason, board, history from hand_record where id = $1', [inserted.rows[0].id]);
      assert.deepEqual(read.rows[0].board, []);
      assert.equal(read.rows[0].end_reason, 'stop_rule');
      assert.equal(read.rows[0].history[0].street, 'preflop');
      await expectDenied(client, 'app', `update hand_record set end_reason = 'fold' where false`);
      await expectDenied(client, 'app', 'delete from hand_record where false');
      for (const role of ['builder', 'capture', 'query']) {
        await expectDenied(client, role, 'select * from hand_record limit 1');
      }
    });
  });

  test("R3.13 a record cannot name another user's session (the composite owner key)", async () => {
    await withRollback(pool, async (client) => {
      const fixture = await handFixture(client);
      await expectCode(client, INSERT_RECORD, recordParams(fixture, { userId: fixture.otherId }), FOREIGN_KEY_VIOLATION);
    });
  });

  test('R3.13 one record per session hand and per ending attempt', async () => {
    await withRollback(pool, async (client) => {
      const fixture = await handFixture(client);
      await client.query(INSERT_RECORD, recordParams(fixture));
      const second = await insertAttempt(client, fixture.ownerId, fixture.sessionId, fixture.solutionId);
      await expectCode(client, INSERT_RECORD, recordParams(fixture, { attemptId: second }), UNIQUE_VIOLATION);
      await expectCode(client, INSERT_RECORD, recordParams(fixture, { handNo: 1 }), UNIQUE_VIOLATION);
      await client.query(INSERT_RECORD, recordParams(fixture, { attemptId: second, handNo: 1 }));
    });
  });

  test('R3.13 the end reason, the board and the history shape are checked', async () => {
    await withRollback(pool, async (client) => {
      const fixture = await handFixture(client);
      await expectCode(client, INSERT_RECORD, recordParams(fixture, { end: 'timeout' }), CHECK_VIOLATION);
      await expectCode(client, INSERT_RECORD, recordParams(fixture, { board: ['Ah', 'Kd', 'Qc', 'Js', 'Th', '9c'] }), CHECK_VIOLATION);
      await expectCode(client, INSERT_RECORD, recordParams(fixture, { handNo: -1 }), CHECK_VIOLATION);
      await expectCode(
        client,
        `insert into hand_record (user_id, session_id, attempt_id, hand_no, hero_position, hero_hand, history, end_reason)
         values ($1, $2, $3, 0, 'BTN', 'AhKd', '{}', 'fold')`,
        [fixture.ownerId, fixture.sessionId, fixture.attemptId],
        CHECK_VIOLATION,
      );
    });
  });

  test("R3.13 the migration's down section drops hand_record and the practice_session key", async () => {
    const source = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    const down = source.split('-- migrate:down')[1];
    assert.ok(down, 'the migration has a down section');
    await withRollback(pool, async (client) => {
      await client.query(down);
      const table = await client.query(`select to_regclass('public.hand_record') as name`);
      assert.equal(table.rows[0].name, null);
      const key = await client.query(
        `select 1 from pg_constraint where conname = 'practice_session_id_user_key' and conrelid = 'practice_session'::regclass`,
      );
      assert.equal(key.rows.length, 0);
    });
  });
});
