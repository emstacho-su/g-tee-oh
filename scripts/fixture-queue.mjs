#!/usr/bin/env node
// Queued build jobs for the dev and test databases (R3.4, O-293, ADR 0018).
//
// Why: flow 5 (A7 section 5) requests coverage for an uncovered spot and expects a queue
// position, which the api gives only for a flop whose build job is queued (O-240). On the Mac the
// builder's planner writes those jobs; the dev stack and CI run no builder (O-189), so the queue
// is empty there. This script writes a small queue for one fixture configuration and pair, the
// way the planner would.
//
// Mechanism: FIXTURE_QUEUE_JOBS are inserted as queued build_job rows (synthetic flops and
// priorities, the same ones the web's mocked api uses) with a fixed tree_config_hash marking them
// as fixtures. The insert is idempotent: on the build_job unique key (configuration, pair, flop,
// tree hash) it does nothing, so a rerun never duplicates or reorders a job. It runs as the
// superuser of DATABASE_URL (the app role cannot insert build_job, A4 section 3) and, like
// fixture-solutions, refuses a database that is not on this machine unless --dev is given.
//
// Usage: node scripts/fixture-queue.mjs [--dev]   (DATABASE_URL from the environment or .env)

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { assertDevDatabase, databaseUrl } from './fixture-solutions.mjs';

export const FIXTURE_QUEUE_CONFIG = 'cfg_6_online_100';
export const FIXTURE_QUEUE_PAIR = 'BB-BTN';
/** Bytea hex for the ASCII "fixture-queue": no real tree configuration hashes to it. */
export const FIXTURE_TREE_CONFIG_HASH = '\\x666978747572652d7175657565';
const PREFLOP_LINES = '{srp}';
const K_RUNOUTS = 20;

/** Highest priority first, so the claim order is the listed order (web/src/fixtures/library.ts). */
export const FIXTURE_QUEUE_JOBS = Object.freeze([
  Object.freeze({ flop: 'Kd8s3h', priority: 5 }),
  Object.freeze({ flop: 'Qc9h4d', priority: 3 }),
  Object.freeze({ flop: 'Th6c2s', priority: 1.5 }),
]);

/** Inserts the queue; returns how many rows were inserted and how many were already there. */
export async function seedFixtureQueue(client, jobs = FIXTURE_QUEUE_JOBS) {
  const counts = { inserted: 0, present: 0 };
  for (const job of jobs) {
    const result = await client.query(
      `insert into build_job (game_config_id, position_pair, flop, preflop_lines, tree_config_hash, k_runouts, priority, status)
       values ($1, $2, $3, $4::text[], $5::bytea, $6, $7, 'queued')
       on conflict (game_config_id, position_pair, flop, tree_config_hash) do nothing`,
      [FIXTURE_QUEUE_CONFIG, FIXTURE_QUEUE_PAIR, job.flop, PREFLOP_LINES, FIXTURE_TREE_CONFIG_HASH, K_RUNOUTS, job.priority],
    );
    if (result.rowCount === 1) counts.inserted += 1;
    else counts.present += 1;
  }
  return counts;
}

export async function main(env = process.env, args = process.argv.slice(2)) {
  const url = databaseUrl(env);
  assertDevDatabase(url, args);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const counts = await seedFixtureQueue(client);
    console.log(
      `fixture-queue: ${counts.inserted} inserted, ${counts.present} already present ` +
        `(${FIXTURE_QUEUE_CONFIG} ${FIXTURE_QUEUE_PAIR})`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`fixture-queue: ${error.message}`);
    process.exit(1);
  });
}
