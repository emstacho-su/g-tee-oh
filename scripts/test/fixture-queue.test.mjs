// Queued fixture build jobs (R3.4, O-293): the seed inserts each job once as queued, on the
// build_job unique key, and reports what was already there; the web mock uses the same queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FIXTURE_QUEUE_CONFIG,
  FIXTURE_QUEUE_JOBS,
  FIXTURE_QUEUE_PAIR,
  FIXTURE_TREE_CONFIG_HASH,
  seedFixtureQueue,
} from '../fixture-queue.mjs';

function fakeClient(rowCounts) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return { rowCount: rowCounts[calls.length - 1] ?? 1 };
    },
  };
}

test('R3.4 every fixture job is inserted queued for the fixture spot, idempotent on the unique key', async () => {
  const client = fakeClient([1, 0, 1]);
  const counts = await seedFixtureQueue(client);
  assert.deepEqual(counts, { inserted: 2, present: 1 });
  assert.equal(client.calls.length, FIXTURE_QUEUE_JOBS.length);
  for (const [index, call] of client.calls.entries()) {
    assert.match(call.text, /on conflict \(game_config_id, position_pair, flop, tree_config_hash\) do nothing/);
    assert.match(call.text, /'queued'\)/);
    assert.deepEqual(call.values.slice(0, 3), [FIXTURE_QUEUE_CONFIG, FIXTURE_QUEUE_PAIR, FIXTURE_QUEUE_JOBS[index].flop]);
    assert.equal(call.values[4], FIXTURE_TREE_CONFIG_HASH);
    assert.equal(call.values[6], FIXTURE_QUEUE_JOBS[index].priority);
  }
});

test('R3.4 the jobs are listed in claim order and match the web mock queue', () => {
  const priorities = FIXTURE_QUEUE_JOBS.map((job) => job.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
  const webFixture = readFileSync(new URL('../../web/src/fixtures/library.ts', import.meta.url), 'utf8');
  for (const job of FIXTURE_QUEUE_JOBS) {
    assert.match(webFixture, new RegExp(`flop: "${job.flop}", priority: ${job.priority},`));
  }
  assert.ok(Object.isFrozen(FIXTURE_QUEUE_JOBS));
});
