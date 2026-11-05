#!/usr/bin/env node
// The .env checks `just mac-up` runs before anything starts (S20, R2.22, O-511): migrate-mac builds
// dbmate's DATABASE_URL from POSTGRES_PASSWORD, so that password must be URL-safe (letters, digits,
// - and _, the rule seaweedfs/start.sh applies to the S3 keys); every other service builds its
// connection from parts (O-146) and does not need it. Only the named key is read from .env and
// nothing is printed but the verdict.
// Usage: node scripts/mac/check-env.mjs
import { pathToFileURL } from 'node:url';

import { MacScriptError, envValue, runMain } from './lib.mjs';

export const URL_SAFE = /^[A-Za-z0-9_-]+$/;

/** POSTGRES_PASSWORD, checked to be set and URL-safe; the value itself is never in a message. */
export function checkPostgresPassword(value) {
  if (!value) throw new MacScriptError('POSTGRES_PASSWORD is not set in .env');
  if (!URL_SAFE.test(value)) {
    throw new MacScriptError('POSTGRES_PASSWORD must use only letters, digits, - and _ (migrate-mac puts it in a URL)');
  }
  return true;
}

export function main(_argv, { env = process.env, dotenv = '.env' } = {}) {
  checkPostgresPassword(envValue('POSTGRES_PASSWORD', env, dotenv));
  console.log('mac-up: .env checks pass');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-up', main);
}
