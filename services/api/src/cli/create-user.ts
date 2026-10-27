/**
 * The create-user command (R3.1, O-233), bundled to dist/create-user.js (build.mjs). A5 has no
 * sign-up route, so this is how the owner account is made:
 *
 *   printf '%s\n' "$PASSWORD" | node dist/create-user.js --email owner@example.com
 *
 * Mechanism: the arguments and the first line of standard input are parsed by create-user-args.ts,
 * the database settings come from the same environment variables the server reads
 * (loadProcessConfig), and auth/users.ts creates the account. On success the new user id goes to
 * stdout and the exit code is 0; on any failure one line goes to stderr, with the password cut out,
 * and the exit code is 1. The pool is closed either way so the process ends. This file is the
 * thin process wiring and is excluded from coverage; everything it calls is tested.
 */
import process from "node:process";

import { createUser } from "../auth/users.js";
import { loadProcessConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { describeFailure, parseCreateUserArgs, readFirstLine } from "./create-user-args.js";

const EXIT_FAILURE = 1;
const ARGV_OFFSET = 2;

async function run(): Promise<void> {
  let password: string | undefined;
  try {
    const { email } = parseCreateUserArgs(process.argv.slice(ARGV_OFFSET));
    password = await readFirstLine(process.stdin);
    const { database: databaseConfig } = loadProcessConfig(process.env);
    const database = createDatabase(databaseConfig);
    try {
      const user = await createUser(database, { email, password });
      process.stdout.write(`${user.id}\n`);
    } finally {
      await database.destroy();
    }
  } catch (error: unknown) {
    process.stderr.write(`${describeFailure(error, password)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await run();
