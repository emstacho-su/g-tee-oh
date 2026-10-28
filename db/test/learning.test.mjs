// The api learning migration (R4.11, R4.13, S31, O-271 to O-277): the seven tracks are seeded with their
// scope, the attempt item columns and indexes exist, holdout items, draws, rounds and summaries carry their
// keys, and the app job queue has its partial index. Grants: app selects, inserts and updates app_job and
// holdout_round, only selects and inserts holdout_draw and holdout_summary (PR #27 review LOW 13), and
// deletes only app_job rows (the done-job prune, PR #27 review MEDIUM 9); builder, capture and query see
// none of them (A4 section 3, ADR 0005). Holdout integrity (PR #27 review HIGH 1, HIGH 4): a round keeps
// its order seed, a result its outcome (answered with an attempt, skipped or unservable without one), an
// item its line history, and a user has at most one open holdout session. Every probe runs inside a
// transaction that rolls back.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { asRole, createPool, expectDenied, withRollback } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

/** Each new table with a column an update probe may set to itself, and whether app may update it (LOW 13). */
const UPDATE_PROBES = Object.freeze({
  app_job: { column: 'attempts', appUpdates: true },
  holdout_draw: { column: 'items', appUpdates: false },
  holdout_round: { column: 'closed_at', appUpdates: true },
  holdout_summary: { column: 'answered', appUpdates: false },
});
const ORDER_SEED = '00000000deadbeef';
const HISTORY = '[{"position": "BTN", "token": "r250", "label": "Raise 2.5"}]';
const OTHER_ROLES = Object.freeze(['builder', 'capture', 'query']);
const BOTH_FORMATS = ['online', 'live'];

/** The seven v1 tracks as services/api/src/learning/tracks.ts holds them (O-271). */
const TRACKS = Object.freeze([
  ['opens', { families: ['rfi'], hero: 'any', formats: BOTH_FORMATS }],
  ['facing-open-ip', { families: ['facing-open', 'squeeze'], hero: 'non_blind', formats: BOTH_FORMATS }],
  ['blind-defense', { families: ['facing-open', 'squeeze'], hero: 'blind', formats: BOTH_FORMATS }],
  ['facing-3bet', { families: ['facing-3bet'], hero: 'any', formats: BOTH_FORMATS }],
  ['four-bet-plus', { families: ['facing-4bet'], hero: 'any', formats: BOTH_FORMATS }],
  ['blind-vs-blind', { families: ['blind-vs-blind'], hero: 'any', formats: BOTH_FORMATS }],
  ['live-limped-straddled', { families: ['limped-isolation', 'straddled-pot'], hero: 'any', formats: ['live'] }],
]);

async function columns(client, table) {
  const { rows } = await client.query(
    `select column_name, is_nullable, column_default from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return new Map(rows.map((row) => [row.column_name, row]));
}

async function indexDef(client, name) {
  const { rows } = await client.query('select indexdef from pg_indexes where indexname = $1', [name]);
  assert.equal(rows.length, 1, `index ${name} exists`);
  return rows[0].indexdef;
}

/** A user, a solution and a track row the holdout probes reference; the caller's transaction rolls them back. */
async function holdoutFixture(client) {
  const user = await client.query(
    `insert into app_user (email, password_hash) values ('holdout-probe@example.invalid', 'x') returning id`,
  );
  const solution = await client.query(
    `insert into solution (kind, source, game_config_id, position_pair, manifest_uri, status)
     values ('preflop', 'own', 'cfg_6_online_100', 'BB-BTN', 'memory://holdout-probe', 'published') returning id`,
  );
  const track = await client.query(`select id from track where key = 'blind-defense'`);
  return { userId: user.rows[0].id, solutionId: solution.rows[0].id, trackId: track.rows[0].id };
}

describe('R4.11 api learning migration (S31)', () => {
  test('R4.11 the seven tracks are seeded with family equilibrium, format cash, weight 1 and their scope', async () => {
    const { rows } = await pool.query('select key, family, format, scope, weight from track order by key');
    const seeded = rows.filter((row) => TRACKS.some(([key]) => key === row.key));
    assert.equal(seeded.length, TRACKS.length);
    for (const [key, scope] of TRACKS) {
      const row = seeded.find((candidate) => candidate.key === key);
      assert.deepEqual(
        { family: row.family, format: row.format, weight: row.weight, scope: row.scope },
        { family: 'equilibrium', format: 'cash', weight: 1, scope },
        key,
      );
    }
  });

  test('R4.11 attempt carries hand_class and panels_revealed with the item and track indexes (O-274)', async () => {
    const attempt = await columns(pool, 'attempt');
    assert.equal(attempt.get('hand_class')?.is_nullable, 'YES');
    assert.deepEqual(
      { nullable: attempt.get('panels_revealed')?.is_nullable, default: attempt.get('panels_revealed')?.column_default },
      { nullable: 'NO', default: 'false' },
    );
    assert.match(await indexDef(pool, 'attempt_item_idx'), /\(user_id, solution_id, node_key, hand_class\)/);
    assert.match(await indexDef(pool, 'attempt_track_ids_idx'), /USING gin \(track_ids\)/);
  });

  test('R4.11 practice_session records failed idle-closer ends: a count from 0 and the last failure (PR #27 review follow-up LOW 3)', async () => {
    const session = await columns(pool, 'practice_session');
    assert.deepEqual(
      { nullable: session.get('idle_close_failures')?.is_nullable, default: session.get('idle_close_failures')?.column_default },
      { nullable: 'NO', default: '0' },
    );
    assert.equal(session.get('idle_close_failed_at')?.is_nullable, 'YES');
  });

  test('R4.11 app_job is keyed by kind and period with a partial index over queued rows (O-275)', async () => {
    const job = await columns(pool, 'app_job');
    for (const name of ['kind', 'period_key', 'run_at', 'status', 'attempts', 'locked_by', 'locked_at', 'last_error']) {
      assert.ok(job.has(name), `app_job.${name}`);
    }
    assert.match(await indexDef(pool, 'app_job_due_idx'), /\(run_at\) WHERE \(status = 'queued'::text\)/);
    await withRollback(pool, async (client) => {
      const insert = `insert into app_job (kind, period_key, run_at) values ('probe', '2026-W44', now())
        on conflict (kind, period_key) do nothing`;
      const first = await asRole(client, 'app', insert);
      const second = await asRole(client, 'app', insert);
      assert.deepEqual([first.rowCount, second.rowCount], [1, 0]);
      await assert.rejects(
        asRole(client, 'app', `update app_job set status = 'lost' where kind = 'probe'`),
        (error) => error.code === '23514',
      );
    });
  });

  test('R4.11 app updates only app_job and holdout_round, deletes only app_job rows; other roles see none (LOW 13)', async () => {
    await withRollback(pool, async (client) => {
      for (const [table, { column, appUpdates }] of Object.entries(UPDATE_PROBES)) {
        await asRole(client, 'app', `select * from "${table}" limit 1`);
        const update = `update "${table}" set ${column} = ${column} where false`;
        if (appUpdates) {
          await asRole(client, 'app', update);
        } else {
          await expectDenied(client, 'app', update);
        }
        if (table === 'app_job') {
          await asRole(client, 'app', `delete from "${table}" where false`);
        } else {
          await expectDenied(client, 'app', `delete from "${table}" where false`);
        }
        for (const role of OTHER_ROLES) {
          await expectDenied(client, role, `select * from "${table}" limit 1`);
        }
      }
    });
  });
});

describe('R4.13 holdout rows (S31, O-276, O-277)', () => {
  test('R4.13 a holdout item is stored once per track, solution, node and hand, and replays from its deal', async () => {
    await withRollback(pool, async (client) => {
      const { solutionId, trackId } = await holdoutFixture(client);
      const insert = `insert into holdout_item
        (track_id, solution_id, node_key, hand, spot_class_key, config_id, pair, line, hero_position, deal_seed, history)
        values ($1, $2, 'cfg_6_online_100/BB-BTN/r250', 'AKs', 'preflop/online/100/facing-open/BB-BTN',
          'cfg_6_online_100', 'BB-BTN', 'r250', 'BB', '00000000deadbeef', $3) returning id, drawn_at, history`;
      const item = await asRole(client, 'app', insert, [trackId, solutionId, HISTORY]);
      assert.deepEqual(item.rows[0].history, JSON.parse(HISTORY));
      assert.ok(item.rows[0].drawn_at instanceof Date);
      await assert.rejects(asRole(client, 'app', insert, [trackId, solutionId, HISTORY]), (error) => error.code === '23505');
      await asRole(client, 'app', `insert into holdout_draw (track_id, seed, items) values ($1, 'abc', 30)`, [trackId]);
    });
  });

  test('R4.13 a round is one per user and month, and a result is one per item and round', async () => {
    await withRollback(pool, async (client) => {
      const { userId, solutionId, trackId } = await holdoutFixture(client);
      const round = await asRole(
        client,
        'app',
        `insert into holdout_round (user_id, month, order_seed) values ($1, '2026-11-01', $2) returning id`,
        [userId, ORDER_SEED],
      );
      const roundId = round.rows[0].id;
      await assert.rejects(
        asRole(client, 'app', `insert into holdout_round (user_id, month, order_seed) values ($1, '2026-11-01', $2)`, [userId, ORDER_SEED]),
        (error) => error.code === '23505',
      );
      const item = await client.query(
        `insert into holdout_item
          (track_id, solution_id, node_key, hand, spot_class_key, config_id, pair, hero_position, deal_seed, history)
          values ($1, $2, 'k', 'AA', 'c', 'cfg_6_online_100', 'BB-BTN', 'BTN', 's', '[]') returning id`,
        [trackId, solutionId],
      );
      const result = `insert into holdout_result (user_id, holdout_item_id, round_id, taken_at, outcome)
        values ($1, $2, $3, now(), 'skipped')`;
      await asRole(client, 'app', result, [userId, item.rows[0].id, roundId]);
      await assert.rejects(
        asRole(client, 'app', result, [userId, item.rows[0].id, roundId]),
        (error) => error.code === '23505',
      );
      await asRole(
        client,
        'app',
        `insert into holdout_summary (round_id, track_id, answered, total, mean_score, mu, rd, goodhart_flag)
         values ($1, $2, 20, 30, 0.81, 1500, 80, false)`,
        [roundId, trackId],
      );
    });
  });
});

describe('R4.13 holdout integrity rows (S31, PR #27 review HIGH 1, HIGH 4)', () => {
  test('R4.13 a round needs a 64-bit hex order seed', async () => {
    await withRollback(pool, async (client) => {
      const { userId } = await holdoutFixture(client);
      await assert.rejects(
        asRole(client, 'app', `insert into holdout_round (user_id, month) values ($1, '2026-12-01')`, [userId]),
        (error) => error.code === '23502',
      );
      await assert.rejects(
        asRole(client, 'app', `insert into holdout_round (user_id, month, order_seed) values ($1, '2026-12-01', 'xyz')`, [userId]),
        (error) => error.code === '23514',
      );
    });
  });

  test('R4.13 a result is answered with an attempt, or skipped or unservable without one', async () => {
    await withRollback(pool, async (client) => {
      const { userId, solutionId, trackId } = await holdoutFixture(client);
      const round = await client.query(
        `insert into holdout_round (user_id, month, order_seed) values ($1, '2026-12-01', $2) returning id`,
        [userId, ORDER_SEED],
      );
      const item = await client.query(
        `insert into holdout_item
          (track_id, solution_id, node_key, hand, spot_class_key, config_id, pair, hero_position, deal_seed, history)
          values ($1, $2, 'k', 'KK', 'c', 'cfg_6_online_100', 'BB-BTN', 'BTN', 's', '[]') returning id`,
        [trackId, solutionId],
      );
      const insert = (outcome) =>
        asRole(
          client,
          'app',
          `insert into holdout_result (user_id, holdout_item_id, round_id, taken_at, outcome) values ($1, $2, $3, now(), $4)`,
          [userId, item.rows[0].id, round.rows[0].id, outcome],
        );
      await assert.rejects(insert('answered'), (error) => error.code === '23514');
      await assert.rejects(insert('lost'), (error) => error.code === '23514');
      await insert('unservable');
    });
  });

  test('R4.13 a user has at most one open holdout session; ended ones and other modes do not count', async () => {
    await withRollback(pool, async (client) => {
      const { userId } = await holdoutFixture(client);
      const insert = (mode, endedAt) =>
        asRole(
          client,
          'app',
          `insert into practice_session (user_id, mode, settings, state, ended_at) values ($1, $2, '{}', '{}', $3)`,
          [userId, mode, endedAt],
        );
      await insert('holdout', new Date());
      await insert('holdout', null);
      await insert('automated', null);
      await insert('automated', null);
      await assert.rejects(insert('holdout', null), (error) => error.code === '23505');
    });
  });
});
