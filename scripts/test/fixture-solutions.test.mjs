// Fixture solution rows (R3.7, O-53): every committed preflop manifest becomes one row; a manifest
// that cannot be a row names its file; configs outside the catalog are skipped, not inserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDevDatabase,
  DEFAULT_LIBRARY,
  FixtureManifestError,
  listFixtureSolutions,
  seedFixtureSolutions,
  toSolutionRow,
} from '../fixture-solutions.mjs';

const ID = '07e6f131-29b1-8211-a009-4441d463643d';
const MANIFEST = {
  kind: 'preflop',
  source: 'reference',
  id: ID,
  config_id: 'cfg_6_online_100',
  pair: 'BB-CO',
  engine_version: 'synthetic',
  synthetic: true,
};

test('R3.7 a preflop manifest becomes a published row with a fixture uri', () => {
  const row = toSolutionRow(MANIFEST, 'preflop/cfg_6_online_100/x/manifest.json');
  assert.deepEqual(row, {
    id: ID,
    source: 'reference',
    game_config_id: 'cfg_6_online_100',
    position_pair: 'BB-CO',
    engine_version: 'synthetic',
    manifest_uri: 'fixture:preflop/cfg_6_online_100/x/manifest.json',
    synthetic: true,
  });
  assert.ok(Object.isFrozen(row));
});

test('R3.7 a manifest that cannot be a row names its file', () => {
  for (const bad of [
    { ...MANIFEST, kind: 'flop_build' },
    { ...MANIFEST, id: 'NOT-A-UUID' },
    { ...MANIFEST, source: 'capture' },
    { ...MANIFEST, config_id: '' },
    { ...MANIFEST, pair: undefined },
  ]) {
    assert.throws(() => toSolutionRow(bad, 'preflop/a/b/manifest.json'), (error) => {
      assert.ok(error instanceof FixtureManifestError);
      assert.match(error.message, /^preflop\/a\/b\/manifest\.json: /);
      return true;
    });
  }
});

test('R3.7 the committed fixture library lists every preflop manifest once', () => {
  const rows = listFixtureSolutions(DEFAULT_LIBRARY);
  assert.ok(rows.length > 0, 'the S19 fixture library is committed');
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'ids are distinct');
  assert.ok(rows.some((row) => row.game_config_id === 'cfg_6_online_100'));
  assert.ok(rows.every((row) => row.manifest_uri.startsWith('fixture:preflop/')));
});

test('R3.7 only a database on this machine is seeded without --dev (PR #25 L3, re-review L5)', () => {
  for (const url of [
    'postgres://u:p@localhost:5432/gto',
    'postgres://u:p@127.0.0.1:65145/postgres?sslmode=disable',
    'postgres://u:p@[::1]:5432/gto',
  ]) {
    assert.doesNotThrow(() => assertDevDatabase(url, []), url);
  }
  // The bare host postgres is the compose service name on the Mac profile too, so it needs --dev.
  for (const url of [
    'postgres://u:p@postgres:5432/gto',
    'postgres://u:p@db.example.com:5432/gto',
    'postgres://u:p@10.0.0.5/gto',
    'not a url',
  ]) {
    assert.throws(() => assertDevDatabase(url, []), /refuses|not a URL/, url);
  }
  assert.doesNotThrow(() => assertDevDatabase('postgres://u:p@db.example.com:5432/gto', ['--dev']));
  assert.throws(() => assertDevDatabase('postgres://u:p@localhost/gto', ['--other']), /unknown argument/);
});

test('R3.7 only synthetic manifests are seeded; a real solution is skipped and counted (PR #25 L3)', async () => {
  const client = {
    async query(sql) {
      if (sql.startsWith('select id from game_config')) return { rows: [{ id: 'cfg_6_online_100' }] };
      return { rowCount: 1 };
    },
  };
  const real = toSolutionRow({ ...MANIFEST, synthetic: false }, 'p/r/manifest.json');
  const absent = toSolutionRow({ ...MANIFEST, id: ID.replace('07e6', '37e6'), synthetic: undefined }, 'p/a/manifest.json');
  const synthetic = toSolutionRow({ ...MANIFEST, id: ID.replace('07e6', '47e6') }, 'p/s/manifest.json');
  const counts = await seedFixtureSolutions(client, [real, absent, synthetic]);
  assert.deepEqual(counts, { inserted: 1, present: 0, skipped: 0, notSynthetic: 2 });
});

test('R3.7 seeding skips configs outside the catalog and counts what exists', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      if (sql.startsWith('select id from game_config')) return { rows: [{ id: 'cfg_6_online_100' }] };
      calls.push(params);
      return { rowCount: calls.length === 1 ? 1 : 0 };
    },
  };
  const rows = [
    toSolutionRow(MANIFEST, 'p/1/manifest.json'),
    toSolutionRow({ ...MANIFEST, id: ID.replace('07e6', '17e6') }, 'p/2/manifest.json'),
    toSolutionRow({ ...MANIFEST, id: ID.replace('07e6', '27e6'), config_id: 'cfg_2_online_norake_10' }, 'p/3/manifest.json'),
  ];
  const counts = await seedFixtureSolutions(client, rows);
  assert.deepEqual(counts, { inserted: 1, present: 1, skipped: 1, notSynthetic: 0 });
  assert.equal(calls.length, 2, 'no insert for a config outside the catalog');
});
