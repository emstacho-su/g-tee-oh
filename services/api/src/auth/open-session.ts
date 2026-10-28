/**
 * Opening a session after a proof of identity (R3.1, O-231; S42 moved it out of routes/auth.ts so
 * login and join share it unchanged). In one transaction the session whose cookie came with the
 * request (if any) is deleted, server-side, so an older or planted cookie never stays alive
 * beside the new one (session fixation); the user's expired sessions are deleted; and a new
 * session is inserted. sessionInfo builds the SessionInfo body login, join and GET /me answer.
 */
import type { Database } from "../db.js";
import type { SessionInfo } from "../schemas/auth.js";
import type { SessionContext } from "./session-context.js";
import { createSession, deleteExpiredSessions, deleteSessionByToken, type NewSession } from "./sessions.js";

/** Replaces the presented session (if any) and the user's expired ones with a new session. */
export async function replaceSession(
  transaction: Database,
  userId: string,
  ttlHours: number,
  previousToken: string | undefined,
): Promise<NewSession> {
  if (previousToken !== undefined) {
    await deleteSessionByToken(transaction, previousToken);
  }
  await deleteExpiredSessions(transaction, userId);
  return createSession(transaction, userId, ttlHours);
}

/** The same, in its own transaction (login). */
export function openSession(
  database: Database,
  userId: string,
  ttlHours: number,
  previousToken: string | undefined,
): Promise<NewSession> {
  return database.transaction().execute((transaction) => replaceSession(transaction, userId, ttlHours, previousToken));
}

export function sessionInfo(session: Omit<SessionContext, "sessionId">): SessionInfo {
  return {
    user: {
      id: session.userId,
      email: session.email,
      display_name: session.displayName,
      created_at: session.userCreatedAt.toISOString(),
      is_admin: session.isAdmin,
    },
    csrf_token: session.csrfToken,
    expires_at: session.expiresAt.toISOString(),
  };
}
