#!/usr/bin/env node
// Learning state for the e2e owner on the dev and test databases (R4.10, R4.12, O-324, O-272).
//
// Why: an automated session serves every new spot class first as an unrated worked example of
// three hands (O-272) and then moves to another new class (the interleave rule), so on a fresh
// account flow 1's five decisions are all unrated and the rating card cannot change; and flow 6
// needs a few weeks of leak history to draw a trend. S31's own integration test seeds schedule
// cards for the same reason (services/api/test/R4.10-automated-kit.ts seedCards). This script
// writes that state for the owner the e2e chain just created, the way the api would have after
// earlier sessions.
//
// Mechanism: the covered (configuration, pair) list is the fixture solution rows that
// fixture-solutions wrote (manifest_uri fixture:, configurations without an ante, O-33). Their
// spot classes come from solver-query's GET /v1/coverage?classes=true, asked from inside the api
// container (solver-query publishes no host port), never composed here (ADR 0004). For the owner
// it inserts one schedule_card per class (two Good reviews 60 and 30 days back, the card S31's
// seedCards builds; services/api/test/fixture-learning-card.test.ts holds the values to learning's
// FSRS adapter), and for the first LEAK_CLASSES classes in key order a leak_stat, a mastery row
// and leak_history for the PAST_WEEKS Mondays before this week (in APP_TIME_ZONE, the api's week).
// Every value is synthetic, from a fixed formula over the class's index. Inserts are idempotent (on
// conflict do nothing), run as the superuser of DATABASE_URL (the app role writes these tables
// only through the api), and, like fixture-solutions, refuse a database that is not on this
// machine unless --dev is given. No credential is read or printed: only the owner's email
// (E2E_OWNER_EMAIL, not secret) and DATABASE_URL.
//
// Usage: node scripts/fixture-learning.mjs [--dev]   (DATABASE_URL and E2E_OWNER_EMAIL from the
// environment or .env; the e2e chain runs it after create-owner)

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { COMPOSE_ARGS } from '../infra/compose/e2e.mjs';
import { ownerEmail } from '../infra/compose/e2e-owner.mjs';
import { assertDevDatabase, databaseUrl } from './fixture-solutions.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
export const LEAK_CLASSES = 10;
export const PAST_WEEKS = 6;
/** The second of the two Good reviews; the first was 30 days before it (60 days back). */
const SECOND_REVIEW_DAYS_AGO = 30;
/** The card ts-fsrs gives after Good at day 0 and Good 30 days later (fixture-learning-card.test.ts). */
export const SEEDED_CARD = Object.freeze({
  stability: 37.42063886,
  difficulty: 2.11121424,
  elapsed_days: 30,
  scheduled_days: 37,
  learning_steps: 0,
  reps: 2,
  lapses: 0,
  state: 2,
});
/** solver-query's key alphabet with room to spare; anything else is refused before an insert. */
const CLASS_KEY = /^[A-Za-z0-9_.:/+-]{1,128}$/;
const MAX_CLASSES = 5000;
const DEFAULT_TIME_ZONE = 'UTC';

/** The stored FSRS card for a class seeded at `now` (the jsonb the api's fsrs-card.ts parses). */
export function seededCard(now) {
  const lastReview = new Date(now.getTime() - SECOND_REVIEW_DAYS_AGO * DAY_MS);
  const due = new Date(lastReview.getTime() + SEEDED_CARD.scheduled_days * DAY_MS);
  return { due: due.toISOString(), ...SEEDED_CARD, last_review: lastReview.toISOString() };
}

/** Synthetic leak figures for the class at `index` (0 is the costliest). */
export function leakSeed(index) {
  const cost = Number((40 - 3.5 * index).toFixed(1));
  const freqPer1k = 20;
  const missRate = 0.25;
  const history = Array.from({ length: PAST_WEEKS }, (_, back) => {
    const drift = (back + 1) * (index % 2 === 0 ? 1.5 : -0.6);
    return Number(Math.max(0, cost + drift).toFixed(1));
  });
  return {
    cost,
    n: 30 + 5 * index,
    freqPer1k,
    missRate,
    evPerMissBb: Number((cost / (freqPer1k * missRate)).toFixed(4)),
    pKnown: Number(Math.min(0.97, 0.2 + 0.08 * index).toFixed(2)),
    history,
  };
}

/** The code the api container runs: reads [[config, pair], ...] on stdin, prints sorted class keys. */
export const CLASS_KEYS_SCRIPT = `
let input = '';
for await (const chunk of process.stdin) input += chunk;
const keys = new Set();
for (const [config, pair] of JSON.parse(input)) {
  const url = new URL('/v1/coverage', process.env.SOLVER_QUERY_URL);
  url.searchParams.set('config_id', config);
  url.searchParams.set('pair', pair);
  url.searchParams.set('classes', 'true');
  const response = await fetch(url);
  if (!response.ok) throw new Error('coverage answered ' + response.status + ' for ' + config + ' ' + pair);
  for (const entry of (await response.json()).spot_classes) keys.add(entry.spot_class_key);
}
process.stdout.write(JSON.stringify([...keys].sort()));
`;

/** Validates the container's answer: a JSON array of class keys, at most MAX_CLASSES. */
export function parseClassKeys(text) {
  let keys;
  try {
    keys = JSON.parse(text);
  } catch {
    throw new Error('the class catalog answer is not JSON');
  }
  if (!Array.isArray(keys) || keys.length > MAX_CLASSES) throw new Error('the class catalog answer is not a list of keys');
  for (const key of keys) {
    if (typeof key !== 'string' || !CLASS_KEY.test(key)) throw new Error('the class catalog holds a malformed key');
  }
  return keys;
}

/** The covered (configuration, pair) list: the fixture solutions at ante-free configurations. */
export async function coveredPairs(client) {
  const result = await client.query(
    `select distinct s.game_config_id, s.position_pair
       from solution s join game_config g on g.id = s.game_config_id
      where s.manifest_uri like 'fixture:%' and g.ante_cbb = 0
      order by 1, 2`,
  );
  return result.rows.map((row) => [row.game_config_id, row.position_pair]);
}

/** Asks solver-query for the classes from inside the api container (see the module doc). */
export function fetchClassKeys(pairs, spawn = spawnSync) {
  const args = [...COMPOSE_ARGS, 'exec', '-T', 'api', 'node', '--input-type=module', '-e', CLASS_KEYS_SCRIPT];
  const result = spawn('docker', args, { input: JSON.stringify(pairs), encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run docker compose exec: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`the class catalog read failed with exit ${result.status}`);
  return parseClassKeys(result.stdout);
}

export async function ownerId(client, email) {
  const result = await client.query('select id from app_user where email = $1', [email]);
  if (result.rows.length !== 1) throw new Error('the e2e owner does not exist; run create-owner first');
  return result.rows[0].id;
}

/** Inserts the owner's learning state; returns how many rows were inserted and already present. */
export async function seedLearning(client, { userId, classKeys, now, timeZone }) {
  const counts = { inserted: 0, present: 0 };
  const count = (result) => {
    counts.inserted += result.rowCount;
    counts.present += result.rowCount === 0 ? 1 : 0;
  };
  const card = seededCard(now);
  for (const key of classKeys) {
    count(await client.query(
      `insert into schedule_card (user_id, spot_class_key, fsrs_state, due) values ($1, $2, $3::jsonb, $4)
       on conflict (user_id, spot_class_key) do nothing`,
      [userId, key, JSON.stringify(card), card.due],
    ));
  }
  for (const [index, key] of classKeys.slice(0, LEAK_CLASSES).entries()) {
    const seed = leakSeed(index);
    count(await client.query(
      `insert into leak_stat (user_id, spot_class_key, freq_prior_per_1k, n, miss_rate, ev_per_miss_bb, leak_cost_bb_per_1k, computed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (user_id, spot_class_key) do nothing`,
      [userId, key, seed.freqPer1k, seed.n, seed.missRate, seed.evPerMissBb, seed.cost, now],
    ));
    count(await client.query(
      `insert into mastery (user_id, spot_class_key, p_known, updated_at) values ($1, $2, $3, $4)
       on conflict (user_id, spot_class_key) do nothing`,
      [userId, key, seed.pKnown, now],
    ));
    for (const [back, cost] of seed.history.entries()) {
      count(await client.query(
        `insert into leak_history (user_id, spot_class_key, week, leak_cost_bb_per_1k)
         values ($1, $2, date_trunc('week', $3::timestamptz at time zone $4)::date - 7 * $5::int, $6)
         on conflict (user_id, spot_class_key, week) do nothing`,
        [userId, key, now, timeZone, back + 1, cost],
      ));
    }
  }
  return counts;
}

export async function main(env = process.env, args = process.argv.slice(2), spawn = spawnSync) {
  const url = databaseUrl(env);
  assertDevDatabase(url, args);
  const email = ownerEmail(env);
  const timeZone = env.APP_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const userId = await ownerId(client, email);
    const pairs = await coveredPairs(client);
    if (pairs.length === 0) throw new Error('no fixture solution rows; run fixture-solutions first');
    const classKeys = fetchClassKeys(pairs, spawn);
    const counts = await seedLearning(client, { userId, classKeys, now: new Date(), timeZone });
    console.log(
      `fixture-learning: ${counts.inserted} inserted, ${counts.present} already present ` +
        `(${classKeys.length} classes over ${pairs.length} pairs, ${Math.min(LEAK_CLASSES, classKeys.length)} with leak history)`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`fixture-learning: ${error.message}`);
    process.exit(1);
  });
}
