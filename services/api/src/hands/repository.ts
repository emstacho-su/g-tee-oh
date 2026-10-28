/**
 * hand_record rows: the hand log (R3.13, S40, O-352, O-400 to O-403, ADR 0001).
 *
 * Mechanism: POST /sessions/{id}/decisions inserts one row inside its transaction when the forward
 * run (sessions/derive.ts deriveFinishedHand) found that the decision ends the hand, with the new
 * attempt as attempt_id; the row copies the hand's previous_hand (hand_no, history, board, end)
 * and the hero's seat and cards. The table is append-only for the app role. Reads are scoped by
 * user_id as well as the session id, so another user's session reads as empty (the route answers
 * 404 for it before reading); the schema also refuses a row whose user does not own the session
 * (the composite key on practice_session (id, user_id)). history is jsonb, written as JSON text
 * cast to jsonb and parsed with its Zod schema on every read, so a malformed row is a loud 500.
 */
import { sql, type RawBuilder, type Selectable } from "kysely";
import { z } from "zod";

import type { DB } from "@g-tee-oh/contracts";

import type { Database } from "../db.js";
import { cardSchema, positionSchema } from "../schemas/common.js";
import { previousHandEndSchema } from "../schemas/training.js";
import type { FinishedHand } from "../sessions/derive.js";
import { historyEntrySchema, type HistoryEntry } from "../sessions/state.js";

type Json = Selectable<DB["hand_record"]>["history"];

const historySchema = z.array(historyEntrySchema);

export interface HandRecordWrite {
  userId: string;
  sessionId: string;
  attemptId: string;
  hand: FinishedHand;
}

export interface HandRecord {
  id: string;
  sessionId: string;
  attemptId: string;
  handNo: number;
  heroPosition: z.infer<typeof positionSchema>;
  heroHand: string;
  history: HistoryEntry[];
  board: string[];
  end: z.infer<typeof previousHandEndSchema>;
  createdAt: Date;
}

export interface HandRecordPage {
  userId: string;
  sessionId: string;
  /** Only hands numbered above this one; undefined from the first hand. */
  afterHandNo: number | undefined;
  limit: number;
}

const COLUMNS = ["id", "session_id", "attempt_id", "hand_no", "hero_position", "hero_hand", "history", "board", "end_reason", "created_at"] as const;

type RawRecord = Pick<Selectable<DB["hand_record"]>, (typeof COLUMNS)[number]>;

function toJsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`cast(${JSON.stringify(value)} as jsonb)`;
}

function toRecord(row: RawRecord): HandRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    attemptId: row.attempt_id,
    handNo: row.hand_no,
    heroPosition: positionSchema.parse(row.hero_position),
    heroHand: row.hero_hand,
    history: historySchema.parse(row.history),
    board: z.array(cardSchema).parse(row.board),
    end: previousHandEndSchema.parse(row.end_reason),
    createdAt: row.created_at,
  };
}

/** Inserts the finished hand's row inside the decision's transaction. */
export async function insertHandRecord(transaction: Database, write: HandRecordWrite): Promise<HandRecord> {
  const { previous } = write.hand;
  const row = await transaction
    .insertInto("hand_record")
    .values({
      user_id: write.userId,
      session_id: write.sessionId,
      attempt_id: write.attemptId,
      hand_no: previous.hand_no,
      hero_position: write.hand.heroPosition,
      hero_hand: write.hand.heroHand,
      history: toJsonb(historySchema.parse(previous.history)),
      board: [...previous.board],
      end_reason: previous.end,
    })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  return toRecord(row);
}

/** One page of the user's hands in one session, by hand number; owner scoped. */
export async function listHandRecords(database: Database, page: HandRecordPage): Promise<HandRecord[]> {
  let query = database
    .selectFrom("hand_record")
    .select(COLUMNS)
    .where("user_id", "=", page.userId)
    .where("session_id", "=", page.sessionId);
  if (page.afterHandNo !== undefined) {
    query = query.where("hand_no", ">", page.afterHandNo);
  }
  const rows = await query.orderBy("hand_no", "asc").limit(page.limit).execute();
  return rows.map(toRecord);
}
