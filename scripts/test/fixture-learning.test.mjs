// The e2e owner's learning seed (R4.10, R4.12, O-324): synthetic cards and leak rows inserted once
// per key, the class catalog read through the api container and validated, the dev-database guard,
// and no credential anywhere but DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASS_KEYS_SCRIPT,
  LEAK_CLASSES,
  PAST_WEEKS,
  SEEDED_CARD,
  coveredPairs,
  fetchClassKeys,
  leakSeed,
  main,
  masteryOf,
  ownerId,
  parseClassKeys,
  seedLearning,
  seededCard,
} from '../fixture-learning.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-28T12:00:00Z');

function fakeClient(answer = () => ({ rowCount: 1, rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return answer(text, values, calls.length - 1);
    },
  };
}

test('R4.10 the seeded card was reviewed 30 days ago and falls due 37 days after that', () => {
  const card = seededCard(NOW);
  assert.equal(card.last_review, new Date(NOW.getTime() - 30 * DAY_MS).toISOString());
  assert.equal(card.due, new Date(NOW.getTime() + 7 * DAY_MS).toISOString());
  assert.equal(card.reps, SEEDED_CARD.reps);
  assert.equal(card.state, SEEDED_CARD.state);
});

test('R4.12 leak seeds fall with the index and carry six past weeks', () => {
  const first = leakSeed(0);
  const second = leakSeed(1);
  assert.ok(first.cost > second.cost);
  assert.equal(first.history.length, PAST_WEEKS);
  assert.ok(first.history.every((cost) => cost >= 0));
  assert.ok(Math.abs(first.freqPer1k * first.missRate * first.evPerMissBb - first.cost) < 0.01);
});

test('R4.12 mastery cycles from 0.2 to 0.92 with one mastered class in every eleven', () => {
  assert.equal(masteryOf(0), 0.2);
  assert.equal(masteryOf(9), 0.92);
  assert.equal(masteryOf(10), 0.97);
  assert.equal(masteryOf(11), 0.2);
});

test('R4.10 seedLearning writes a card and mastery per class and leak and history rows for the first ten, idempotent', async () => {
  const keys = Array.from({ length: 12 }, (_, index) => `preflop/online/100/rfi/k${String(index).padStart(2, '0')}`);
  const client = fakeClient((_, __, index) => ({ rowCount: index % 5 === 0 ? 0 : 1, rows: [] }));
  const counts = await seedLearning(client, { userId: 'u1', classKeys: keys, now: NOW, timeZone: 'UTC' });
  const expectedCalls = 2 * keys.length + LEAK_CLASSES * (1 + PAST_WEEKS);
  assert.equal(client.calls.length, expectedCalls);
  assert.equal(counts.inserted + counts.present, expectedCalls);
  assert.ok(counts.present > 0);
  for (const call of client.calls) {
    assert.match(call.text, /on conflict \(user_id, spot_class_key(, week)?\) do nothing/);
    assert.equal(call.values[0], 'u1');
  }
  const cards = client.calls.filter((call) => call.text.includes('schedule_card'));
  assert.equal(cards.length, keys.length);
  assert.deepEqual(JSON.parse(cards[0].values[2]), seededCard(NOW));
  const mastery = client.calls.filter((call) => call.text.includes('into mastery'));
  assert.deepEqual(mastery.map((call) => call.values[2]), keys.map((_, index) => masteryOf(index)));
  const history = client.calls.filter((call) => call.text.includes('leak_history'));
  assert.deepEqual(history.slice(0, PAST_WEEKS).map((call) => call.values[4]), [1, 2, 3, 4, 5, 6]);
  assert.match(history[0].text, /date_trunc\('week', \$3::timestamptz at time zone \$4\)/);
});

test('R4.10 the class catalog answer must be a JSON list of well-formed keys', () => {
  assert.deepEqual(parseClassKeys('["preflop/online/100/rfi/BB-BTN"]'), ['preflop/online/100/rfi/BB-BTN']);
  assert.throws(() => parseClassKeys('not json'), /not JSON/);
  assert.throws(() => parseClassKeys('{"a":1}'), /not a list/);
  assert.throws(() => parseClassKeys('["bad key; drop table"]'), /malformed/);
  assert.throws(() => parseClassKeys('[1]'), /malformed/);
});

test('R4.10 the catalog is read inside the api container with the pairs on stdin', () => {
  const seen = [];
  const spawn = (command, args, options) => {
    seen.push({ command, args, options });
    return { status: 0, stdout: '["k1","k2"]' };
  };
  assert.deepEqual(fetchClassKeys([['cfg_6_online_100', 'BB-BTN']], spawn), ['k1', 'k2']);
  assert.equal(seen[0].command, 'docker');
  assert.deepEqual(seen[0].args.slice(-7), ['exec', '-T', 'api', 'node', '--input-type=module', '-e', CLASS_KEYS_SCRIPT]);
  assert.equal(seen[0].options.input, '[["cfg_6_online_100","BB-BTN"]]');
  assert.match(CLASS_KEYS_SCRIPT, /classes', 'true'/);
  assert.throws(() => fetchClassKeys([], () => ({ status: 1, stdout: '' })), /exit 1/);
  assert.throws(() => fetchClassKeys([], () => ({ error: new Error('no docker') })), /no docker/);
});

test('R4.10 the owner must exist, and the pairs come from fixture solutions without an ante', async () => {
  await assert.rejects(ownerId(fakeClient(() => ({ rows: [] })), 'owner@example.com'), /create-owner/);
  assert.equal(await ownerId(fakeClient(() => ({ rows: [{ id: 'u1' }] })), 'owner@example.com'), 'u1');
  const client = fakeClient(() => ({ rows: [{ game_config_id: 'cfg_6_online_100', position_pair: 'BB-BTN' }] }));
  assert.deepEqual(await coveredPairs(client), [['cfg_6_online_100', 'BB-BTN']]);
  assert.match(client.calls[0].text, /manifest_uri like 'fixture:%' and g.ante_cbb = 0/);
});

test('R4.10 main refuses a database that is not on this machine before connecting', async () => {
  // databaseUrl (fixture-solutions.mjs) answers process.env.DATABASE_URL, so the test sets it there.
  const saved = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgres://u:p@db.example.com:5432/gto';
    await assert.rejects(main(process.env, []), /refuses to write to db.example.com/);
    process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/gto';
    await assert.rejects(main(process.env, ['--force']), /unknown argument/);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});
