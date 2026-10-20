// Seed tests (R0.6): exactly one game_config per v1 configuration from 01 product spec section 3 (eleven
// rows, straddle off per O-72, ante 0 per O-33), the three stakes with their caps in big blinds (ADR 0014),
// the unverified note on the 2/5 row (O-2, O-66, O-71), and a placeholder sizing convention of source
// manual behind every configuration with a sha256 spec_hash that matches its spec.

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

const V1_CONFIG_IDS = Object.freeze([
  'cfg_6_online_100',
  'cfg_6_online_150',
  'cfg_6_online_200',
  'cfg_9_live_13_100',
  'cfg_9_live_13_150',
  'cfg_9_live_13_200',
  'cfg_9_live_13_300',
  'cfg_9_live_25_100',
  'cfg_9_live_25_150',
  'cfg_9_live_25_200',
  'cfg_9_live_25_300',
]);

const SPEC_KEYS = Object.freeze([
  'fourbet',
  'iso_rule',
  'open_bb',
  'placeholder_for',
  'postflop',
  'straddle_bb',
  'threebet_ip',
  'threebet_oop',
]);

describe('R0.6 catalog seed', () => {
  test('R0.6 exactly one game_config per v1 configuration, straddle off (O-72), ante 0 (O-33)', async () => {
    const { rows } = await pool.query(
      `select id, format, table_size, depth_cbb, straddle, ante_cbb from game_config order by id`,
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      [...V1_CONFIG_IDS].sort(),
    );
    assert.equal(rows.length, 11);
    for (const row of rows) {
      assert.equal(row.straddle, false, `${row.id} straddle`);
      assert.equal(row.ante_cbb, 0, `${row.id} ante_cbb`);
      const [, tableSize, format, ...rest] = row.id.split('_');
      const depthBb = Number(rest.at(-1));
      assert.equal(row.table_size, Number(tableSize), `${row.id} table_size`);
      assert.equal(row.format, format, `${row.id} format`);
      assert.equal(row.depth_cbb, depthBb * 100, `${row.id} depth_cbb is centi-big-blinds`);
    }
  });

  test('R0.6 the three stakes carry the ADR 0014 rake caps in big blinds', async () => {
    const { rows } = await pool.query(
      `select format, label, bb_cents, rake_percent_bp, rake_cap_cents, no_flop_no_drop, note,
              round(rake_cap_cents::numeric / bb_cents, 2) as cap_bb
       from stake order by format, label`,
    );
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
    assert.deepEqual(Object.keys(byLabel).sort(), ['1/3', '2/5', 'online']);

    assert.equal(byLabel['1/3'].format, 'live');
    assert.equal(byLabel['1/3'].bb_cents, 300);
    assert.equal(byLabel['1/3'].rake_percent_bp, 1000);
    assert.equal(byLabel['1/3'].rake_cap_cents, 500);
    assert.equal(byLabel['1/3'].no_flop_no_drop, true);
    assert.equal(byLabel['1/3'].cap_bb, '1.67');
    assert.equal(byLabel['1/3'].note, null);

    assert.equal(byLabel['2/5'].format, 'live');
    assert.equal(byLabel['2/5'].bb_cents, 500);
    assert.equal(byLabel['2/5'].rake_percent_bp, 1000);
    assert.equal(byLabel['2/5'].rake_cap_cents, 500);
    assert.equal(byLabel['2/5'].no_flop_no_drop, true);
    assert.equal(byLabel['2/5'].cap_bb, '1.00');

    assert.equal(byLabel.online.format, 'online');
    assert.equal(byLabel.online.bb_cents, 50);
    assert.equal(byLabel.online.rake_percent_bp, 500);
    assert.equal(byLabel.online.rake_cap_cents, 150);
    assert.equal(byLabel.online.no_flop_no_drop, false);
    assert.match(byLabel.online.note, /O-7/);
  });

  test('R0.6 the 2/5 row is flagged unverified in its note (O-2, O-66, O-71)', async () => {
    const { rows } = await pool.query(`select note from stake where format = 'live' and label = '2/5'`);
    assert.equal(rows.length, 1);
    assert.match(rows[0].note, /unverified/);
    assert.match(rows[0].note, /O-66/);
  });

  test('R0.6 every game_config references a sizing_convention with source manual', async () => {
    const { rows } = await pool.query(
      `select g.id, s.source, s.spec, s.spec_hash,
              (s.spec_hash = digest(s.spec::text, 'sha256')) as hash_matches
       from game_config g join sizing_convention s on s.id = g.sizing_convention_id
       order by g.id`,
    );
    assert.equal(rows.length, 11);
    for (const row of rows) {
      assert.equal(row.source, 'manual', `${row.id} convention source`);
      assert.equal(row.hash_matches, true, `${row.id} spec_hash is sha256 of the canonical spec text`);
      assert.equal(row.spec_hash.length, 32, `${row.id} spec_hash is 32 bytes`);
      assert.deepEqual(Object.keys(row.spec).sort(), SPEC_KEYS, `${row.id} spec keys`);
      assert.equal(row.spec.placeholder_for, row.id);
      assert.equal(row.spec.straddle_bb, null, 'straddle off, no straddle size (O-72)');
      assert.ok(row.spec.open_bb > 0);
      assert.deepEqual(Object.keys(row.spec.postflop).sort(), ['flop', 'river', 'turn']);
      for (const sizes of Object.values(row.spec.postflop)) {
        assert.ok(Array.isArray(sizes) && sizes.length > 0);
        for (const fraction of sizes) {
          assert.ok(fraction > 0 && fraction <= 2, 'postflop sizes are fractions of the pot');
        }
      }
    }
  });

  test('R0.6 the eleven placeholder conventions have distinct spec hashes', async () => {
    const { rows } = await pool.query(
      `select count(*)::int as rows, count(distinct spec_hash)::int as hashes
       from sizing_convention where source = 'manual' and spec ? 'placeholder_for'`,
    );
    assert.equal(rows[0].rows, 11);
    assert.equal(rows[0].hashes, 11);
  });

  test('R0.6 each game_config points at the stake its id names', async () => {
    const { rows } = await pool.query(
      `select g.id, s.format, s.label from game_config g join stake s on s.id = g.stake_id order by g.id`,
    );
    const expectedLabel = { online: 'online', 13: '1/3', 25: '2/5' };
    for (const row of rows) {
      const parts = row.id.split('_');
      const code = parts[2] === 'online' ? 'online' : parts[3];
      assert.equal(row.label, expectedLabel[code], `${row.id} stake label`);
      assert.equal(row.format, parts[2], `${row.id} stake format`);
    }
  });
});
