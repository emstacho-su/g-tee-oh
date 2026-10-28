/**
 * GET /sessions/{id}/hands (R3.13, S40, O-403): one page of a session's finished hands, by hand
 * number. Owner scoped twice: the session is read with the caller's user id first, so a session of
 * another user answers the same 404 as one that does not exist (sessionNotFound, as GET /next),
 * and the rows are read with the caller's user id as well (hands/repository.ts). Paging uses the
 * shared cursor and limit (http/pagination.ts, http/cursor.ts); the cursor carries the last hand
 * number and a tampered one is a 400.
 */
import { decodeCursor, paginate } from "../http/cursor.js";
import { requireDatabase } from "../http/database.js";
import type { Page, PageQuery } from "../http/pagination.js";
import { sessionNotFound } from "../grading/decide.js";
import { cardsOf } from "../sessions/derive.js";
import { findSession } from "../sessions/repository.js";
import type { SessionCall } from "../sessions/session-call.js";
import { handCursorSchema, type HandRecordView } from "../schemas/hands.js";
import { listHandRecords, type HandRecord } from "./repository.js";

function toView(record: HandRecord): HandRecordView {
  return {
    hand_no: record.handNo,
    history: record.history,
    board: record.board,
    end: record.end,
    hero_position: record.heroPosition,
    hero_hand: cardsOf(record.heroHand),
    attempt_id: record.attemptId,
    created_at: record.createdAt.toISOString(),
  };
}

export async function listSessionHands(call: SessionCall, sessionId: string, query: PageQuery): Promise<Page<HandRecordView>> {
  const database = requireDatabase(call.app);
  if ((await findSession(database, call.userId, sessionId)) === undefined) {
    throw sessionNotFound();
  }
  const afterHandNo = query.cursor === undefined ? undefined : decodeCursor(query.cursor, handCursorSchema).hand_no;
  // One row past the page signals that another page exists (paginate).
  const rows = await listHandRecords(database, { userId: call.userId, sessionId, afterHandNo, limit: query.limit + 1 });
  const page = paginate(rows, query.limit, (row) => ({ hand_no: row.handNo }));
  return { items: page.items.map(toView), next_cursor: page.next_cursor };
}
