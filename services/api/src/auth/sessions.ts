/**
 * auth_session rows (R3.1, A9 section 3, O-230, O-231): creating one at login, deleting one at
 * logout, and deleting a user's expired rows.
 *
 * Mechanism: a new session draws a 32-byte random token for the cookie and stores only its sha256
 * (tokens.ts), so a copy of the table cannot be replayed as a cookie, plus a separate random CSRF
 * (cross-site request forgery) token that the browser echoes in x-csrf-token. expires_at is fixed
 * at creation as now plus the configured lifetime and never moves (absolute expiry, no sliding
 * renewal, O-231). Expired rows are cleaned in two places: the authentication hook deletes one when
 * it is presented (plugins/authenticate.ts), and login deletes the rest of that user's, so the
 * table does not grow with abandoned sessions. Every function takes a Kysely handle, so a caller
 * may pass a transaction.
 */
import type { Database } from "../db.js";
import { newCsrfToken, newSessionToken } from "./tokens.js";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface NewSession {
  sessionId: string;
  /** The cookie value; never stored. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/** The absolute expiry of a session created at `now` (O-231). */
export function sessionExpiry(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * MS_PER_HOUR);
}

/** Inserts a session row for the user and returns what the cookie and the body carry. */
export async function createSession(
  database: Database,
  userId: string,
  ttlHours: number,
  now: Date = new Date(),
): Promise<NewSession> {
  const { token, hash } = newSessionToken();
  const csrfToken = newCsrfToken();
  const row = await database
    .insertInto("auth_session")
    .values({ user_id: userId, token_hash: hash, csrf_token: csrfToken, expires_at: sessionExpiry(now, ttlHours) })
    .returning(["id", "expires_at"])
    .executeTakeFirstOrThrow();
  return { sessionId: row.id, token, csrfToken, expiresAt: row.expires_at };
}

/** Deletes one session row; deleting a row that is already gone is not an error. */
export async function deleteSession(database: Database, sessionId: string): Promise<void> {
  await database.deleteFrom("auth_session").where("id", "=", sessionId).execute();
}

/** Deletes the user's sessions whose expiry is at or before `now`; returns how many went. */
export async function deleteExpiredSessions(
  database: Database,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const result = await database
    .deleteFrom("auth_session")
    .where("user_id", "=", userId)
    .where("expires_at", "<=", now)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
