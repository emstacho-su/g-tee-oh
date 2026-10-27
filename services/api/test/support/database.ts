/**
 * Integration test fixtures over the Postgres test container (R3.1). Users and sessions are
 * written the way the api writes them (argon2id hash, sha256 of the session token, O-231), so a
 * test can start from a logged-in state without depending on the login route. Every helper takes
 * unique emails, so test files share one database without interfering.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { inject } from "vitest";

import { hashPassword } from "../../src/auth/password.js";
import { newCsrfToken, newSessionToken } from "../../src/auth/tokens.js";
import { createDatabaseFromUrl, type Database } from "../../src/db.js";

export const TEST_PASSWORD = "correct horse battery staple";
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_HOURS = 24;

/** A Kysely handle connected as the app role, like the api in production. */
export function appDatabase(): Database {
  return createDatabaseFromUrl(inject("appDatabaseUrl"));
}

/** A superuser pool for fixtures the app role cannot write and for direct assertions. */
export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: inject("adminDatabaseUrl"), max: 2 });
}

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createTestUser(
  database: Database,
  options: { email?: string; password?: string } = {},
): Promise<TestUser> {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? TEST_PASSWORD;
  const row = await database
    .insertInto("app_user")
    .values({ email, password_hash: await hashPassword(password) })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, email, password };
}

export interface TestSession {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createTestSession(
  database: Database,
  userId: string,
  options: { expiresAt?: Date } = {},
): Promise<TestSession> {
  const { token, hash } = newSessionToken();
  const csrfToken = newCsrfToken();
  const expiresAt = options.expiresAt ?? new Date(Date.now() + DEFAULT_SESSION_HOURS * HOUR_MS);
  const row = await database
    .insertInto("auth_session")
    .values({ user_id: userId, token_hash: hash, csrf_token: csrfToken, expires_at: expiresAt })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { sessionId: row.id, token, csrfToken, expiresAt };
}
