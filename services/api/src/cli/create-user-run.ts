/**
 * The create-user command as one testable function (R3.1, R3.5, O-233, O-242): parse the
 * arguments, read the password from standard input, open the right connection, create the account
 * and describe a failure in one redacted line. cli/create-user.ts only hands it the process.
 *
 * Which connection (PR #25 review L1): the app role may insert app_user's email and password_hash
 * only, so it can never make an admin. A plain create-user connects as the app login from the same
 * PG* and APP_DB_PASSWORD variables the server reads (loadProcessConfig). create-user --admin
 * connects instead through CREATE_USER_ADMIN_DATABASE_URL, a postgres:// URL of the database owner
 * (the compose superuser, POSTGRES_PASSWORD) or of a role allowed to insert is_admin, and needs no
 * other variable. The server never reads that variable, and the plain path never looks at it. In
 * compose, pass it through from the caller's environment without a value on the command line, so
 * it shows neither in the process list nor in shell history:
 *
 *   CREATE_USER_ADMIN_DATABASE_URL=postgres://postgres:...@postgres:5432/gto \
 *     docker compose exec -T -e CREATE_USER_ADMIN_DATABASE_URL api \
 *     node services/api/dist/create-user.js --email owner@example.com --admin   (password on stdin)
 *
 * The URL is never logged: a malformed value is refused by naming the variable only, and every
 * failure message has the password, the URL and the URL's password cut out (describeFailure).
 */
import { z } from "zod";

import { createUser } from "../auth/users.js";
import { loadProcessConfig } from "../config.js";
import { createDatabase, createDatabaseFromUrl, type Database } from "../db.js";
import { CreateUserUsageError, describeFailure, parseCreateUserArgs, readFirstLine } from "./create-user-args.js";

/** The owner connection create-user --admin uses; read only by this command (PR #25 review L1). */
export const ADMIN_DATABASE_URL_VARIABLE = "CREATE_USER_ADMIN_DATABASE_URL";

const POSTGRES_PROTOCOLS = /^postgres(ql)?$/;
const ownerUrlSchema = z.url({ protocol: POSTGRES_PROTOCOLS });

export type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export type CreateUserOutcome = { ok: true; userId: string } | { ok: false; message: string };

/** The percent-decoded text, or the text itself when it is not valid percent-encoding. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** What the owner URL holds that a message must never show: the URL itself and its password. */
function urlSecrets(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === "") {
    return [];
  }
  const parsed = URL.canParse(raw) ? new URL(raw) : null;
  const password = parsed === null || parsed.password === "" ? [] : [parsed.password, decoded(parsed.password)];
  return [raw, ...password];
}

/** Every secret a failure message of this run must not show. */
function runSecrets(env: ProcessEnvironment, admin: boolean, password: string | undefined): readonly (string | undefined)[] {
  const connection = admin ? urlSecrets(env[ADMIN_DATABASE_URL_VARIABLE]?.trim()) : [env.APP_DB_PASSWORD];
  return [password, ...connection];
}

/** The owner connection for --admin; refuses a missing or malformed URL by naming the variable only. */
export function ownerDatabase(env: ProcessEnvironment): Database {
  const raw = env[ADMIN_DATABASE_URL_VARIABLE]?.trim();
  if (raw === undefined || raw === "") {
    throw new CreateUserUsageError(
      `--admin needs ${ADMIN_DATABASE_URL_VARIABLE}, a postgres:// URL of the database owner; the app login cannot set is_admin.`,
    );
  }
  if (!ownerUrlSchema.safeParse(raw).success) {
    throw new CreateUserUsageError(`${ADMIN_DATABASE_URL_VARIABLE} is not a postgres:// URL.`);
  }
  return createDatabaseFromUrl(raw);
}

/** The connection for one run: the owner for --admin, the app login otherwise. */
function openDatabase(env: ProcessEnvironment, admin: boolean): Database {
  return admin ? ownerDatabase(env) : createDatabase(loadProcessConfig(env).database);
}

/** Runs the command once; never throws, and a failure message is one redacted line. */
export async function runCreateUser(
  argv: readonly string[],
  input: AsyncIterable<unknown>,
  env: ProcessEnvironment,
): Promise<CreateUserOutcome> {
  let password: string | undefined;
  let admin = false;
  try {
    const args = parseCreateUserArgs(argv);
    admin = args.admin;
    password = await readFirstLine(input);
    const database = openDatabase(env, admin);
    try {
      const user = await createUser(database, { email: args.email, password, isAdmin: admin });
      return { ok: true, userId: user.id };
    } finally {
      await database.destroy();
    }
  } catch (error: unknown) {
    return { ok: false, message: describeFailure(error, ...runSecrets(env, admin, password)) };
  }
}
