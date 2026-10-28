// The api learning migration (R4.11, R4.13, S31, O-271 to O-277): the seven tracks are seeded with their
// scope, the attempt item columns and indexes exist, holdout items, draws, rounds and summaries carry their
// keys, and the app job queue has its partial index. Grants: app selects, inserts and updates the four new
// tables and deletes none; builder, capture and query see none of them (A4 section 3, ADR 0005). Every probe
// runs inside a transaction that rolls back.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { asRole, createPool, expectDenied, withRollback } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

/** Each new table with a column an update probe may set to itself. */
const UPDATE_PROBES = Object.freeze({
  app_job: 'attempts',
  holdout_draw: 'items',
  holdout_round: 'closed_at',
  holdout_summary: 'answered',
});
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

  test('R4.11 app selects, inserts and updates the new tables and deletes none; other roles see none', async () => {
    await withRollback(pool, async (client) => {
      for (const [table, column] of Object.entries(UPDATE_PROBES)) {
        await asRole(client, 'app', `select * from "${table}" limit 1`);
        await asRole(client, 'app', `update "${table}" set ${column} = ${column} where false`);
        await expectDenied(client, 'app', `delete from "${table}" where false`);
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
        (track_id, solution_id, node_key, hand, spot_class_key, config_id, pair, line, hero_position, deal_seed)
        values ($1, $2, 'cfg_6_online_100/BB-BTN/r250', 'AKs', 'preflop/online/100/facing-open/BB-BTN',
          'cfg_6_online_100', 'BB-BTN', 'r250', 'BB', '00000000deadbeef') returning id, drawn_at`;
      const item = await asRole(client, 'app', insert, [trackId, solutionId]);
      assert.ok(item.rows[0].drawn_at instanceof Date);
      await assert.rejects(asRole(client, 'app', insert, [trackId, solutionId]), (error) => error.code === '23505');
      await asRole(client, 'app', `insert into holdout_draw (track_id, seed, items) values ($1, 'abc', 30)`, [trackId]);
    });
  });

  test('R4.13 a round is one per user and month, and a result is one per item and round', async () => {
    await withRollback(pool, async (client) => {
      const { userId, solutionId, trackId } = await holdoutFixture(client);
      const round = await asRole(
        client,
        'app',
        `insert into holdout_round (user_id, month) values ($1, '2026-11-01') returning id`,
        [userId],
      );
      const roundId = round.rows[0].id;
      await assert.rejects(
        asRole(client, 'app', `insert into holdout_round (user_id, month) values ($1, '2026-11-01')`, [userId]),
        (error) => error.code === '23505',
      );
      const item = await client.query(
        `insert into holdout_item
          (track_id, solution_id, node_key, hand, spot_class_key, config_id, pair, hero_position, deal_seed)
          values ($1, $2, 'k', 'AA', 'c', 'cfg_6_online_100', 'BB-BTN', 'BTN', 's') returning id`,
        [trackId, solutionId],
      );
      const result = `insert into holdout_result (user_id, holdout_item_id, round_id, taken_at) values ($1, $2, $3, now())`;
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
