/**
 * The heartbeat recheck of one event stream (R3.4, R3.5, O-243, PR #25 review L2): one query
 * reads the stream's auth_session row joined to its user. The session is live while the row
 * exists and its absolute expiry (O-231) is still ahead; the admin flag is read fresh, as
 * requireAdmin reads it on every admin request (O-242), so revoking it reaches open streams too.
 */
import type { Database } from "../db.js";
import type { StreamCheck, StreamStatus } from "./hub.js";

const ENDED: StreamStatus = { live: false, isAdmin: false };

/** The recheck for a stream opened with the session; `now` is injectable for tests. */
export function sessionStreamCheck(
  database: Database,
  sessionId: string,
  now: () => Date = () => new Date(),
): StreamCheck {
  return async () => {
    const row = await database
      .selectFrom("auth_session")
      .innerJoin("app_user", "app_user.id", "auth_session.user_id")
      .select(["auth_session.expires_at", "app_user.is_admin"])
      .where("auth_session.id", "=", sessionId)
      .executeTakeFirst();
    if (row === undefined || row.expires_at.getTime() <= now().getTime()) {
      return ENDED;
    }
    return { live: true, isAdmin: row.is_admin };
  };
}
