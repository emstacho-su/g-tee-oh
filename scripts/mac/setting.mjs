#!/usr/bin/env node
// One builder setting written on the running stack (S20, R2.22, O-509): `just mac-setting KEY VALUE`
// upserts builder_setting(key, value) through psql in the Postgres container, so Deploy 1 can turn
// planning off (`plan_configs []`) and write K (`k_runouts 20`, `k_runouts_rare 10`, O-14, O-191)
// before the builder starts. The key must be one the builder reads (settings.rs KEYS) and the value
// valid JSON; both reach psql as variables on stdin's script (:'key', :'value'), never spliced into
// the SQL text. The builder reads every row on each claim, so no restart is needed (R2.18).
// Usage: node scripts/mac/setting.mjs <key> <json value> [--profile mac|dev]
import { pathToFileURL } from 'node:url';

import { DEFAULT_PROFILE, MacScriptError, checkProfile, parseFlags, psqlArgs, run, runMain } from './lib.mjs';

/** The keys the builder reads (services/library-builder/src/settings.rs KEYS). */
export const BUILDER_KEYS = [
  'paused', 'cpu_share', 'overnight', 'budget_bytes', 'bytes_per_runout', 'bytes_per_flop_tree',
  'k_runouts', 'k_runouts_rare', 'k_frequent_pairs', 'plan_configs', 'target_pct_pot', 'max_iterations',
  'max_seconds_per_line', 'storage_bits', 'memory_cap_bytes', 'max_attempts', 'stale_hours',
  'verify_interval_hours', 'plan_interval_minutes', 'poll_seconds',
];

export const UPSERT_SQL = `insert into builder_setting (key, value) values (:'key', :'value'::jsonb)
  on conflict (key) do update set value = excluded.value
  returning key || ' = ' || value::text;
`;

/** The key and the value, checked; the value is returned in its compact JSON form. */
export function checkSetting(key, value) {
  if (!BUILDER_KEYS.includes(key)) {
    throw new MacScriptError(`${JSON.stringify(key)} is not a key the builder reads: ${BUILDER_KEYS.join(', ')}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MacScriptError(`the value ${JSON.stringify(value)} is not JSON (a list is written [] or ["cfg_6_online_100"])`);
  }
  return JSON.stringify(parsed);
}

export function main(argv, { runner = run } = {}) {
  const [key, value, ...rest] = argv;
  if (key === undefined || value === undefined) {
    throw new MacScriptError('usage: setting.mjs <key> <json value> [--profile mac|dev]');
  }
  const flags = parseFlags(rest, { values: ['profile'] });
  const profile = checkProfile(flags.profile ?? DEFAULT_PROFILE);
  const json = checkSetting(key, value);
  const args = psqlArgs(profile, { variables: { key, value: json } });
  console.log(runner('docker', args, { input: UPSERT_SQL }).trim());
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-setting', main);
}
