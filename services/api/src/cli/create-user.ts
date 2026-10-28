/**
 * The create-user command (R3.1, O-233), bundled to dist/create-user.js (build.mjs). A5 has no
 * sign-up route, so this is how the owner account is made:
 *
 *   printf '%s\n' "$PASSWORD" | node dist/create-user.js --email owner@example.com
 *   printf '%s\n' "$PASSWORD" | CREATE_USER_ADMIN_DATABASE_URL=postgres://... node dist/create-user.js --email owner@example.com --admin
 *
 * --admin sets app_user.is_admin, which the admin builder endpoints require (O-242). The app login
 * cannot set that column (PR #25 review L1), so --admin connects through
 * CREATE_USER_ADMIN_DATABASE_URL, the database owner's URL; a plain run connects as the app login
 * from the same environment variables the server reads. cli/create-user-run.ts documents both.
 *
 * Mechanism: runCreateUser does the work and never throws. On success the new user id goes to
 * stdout and the exit code is 0; on any failure one line goes to stderr, with the password and the
 * owner URL cut out, and the exit code is 1. This file is the thin process wiring and is excluded
 * from coverage; everything it calls is tested.
 */
import process from "node:process";

import { runCreateUser } from "./create-user-run.js";

const EXIT_FAILURE = 1;
const ARGV_OFFSET = 2;

const outcome = await runCreateUser(process.argv.slice(ARGV_OFFSET), process.stdin, process.env);
if (outcome.ok) {
  process.stdout.write(`${outcome.userId}\n`);
} else {
  process.stderr.write(`${outcome.message}\n`);
  process.exitCode = EXIT_FAILURE;
}
