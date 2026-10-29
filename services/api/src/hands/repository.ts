/**
 * hand_record rows: the hand log (R3.13, S40, O-352, O-400 to O-403, ADR 0001).
 *
 * Mechanism: POST /sessions/{id}/decisions inserts one row inside its transaction when the forward
 * run (sessions/derive.ts deriveFinishedHand) found that the decision ends the hand, with the new
 * attempt as attempt_id; the row copies the hand's previous_hand (hand_no, history, board, end)
 * and the hero's seat and cards. The table is append-only for the app role. Reads are scoped by
 * user_id as well as the session id, so another user's session reads as empty (the route answers
 * 404 for it before reading); the schema also refuses a row whose user does not own the session
 * or the attempt (the composite keys on practice_session and attempt (id, user_id)). history is
 * jsonb, written as JSON text cast to jsonb and parsed with its Zod schema on every read, so a
 * malformed row is a loud 500.
 *
 * Writes (security review L3, review round 1 A): handRecordValues validates the row before the
 * decision's transaction opens (history, a board of at most five cards, the hero's two distinct
 * hole cards), so a bad hand is skipped with a warning instead of failing the decision; the insert
 * does nothing on a key it already holds, so the log can never roll a decision back.
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

/** The most board cards a hand can reach (the river). */
const MAX_BOARD_CARDS = 5;
const CARD_TEXT_LENGTH = 2;

/** The hero's hole cards as stored ("AhKd"): two cards, never the same one twice. */
const heroHandSchema = z
  .string()
  .length(CARD_TEXT_LENGTH * 2)
  .refine((text) => cardSchema.safeParse(text.slice(0, CARD_TEXT_LENGTH)).success && cardSchema.safeParse(text.slice(CARD_TEXT_LENGTH)).success, "two cards")
  .refine((text) => text.slice(0, CARD_TEXT_LENGTH) !== text.slice(CARD_TEXT_LENGTH), "two different cards");

const handRecordValuesSchema = z.strictObject({
  hand_no: z.number().int().min(0),
  hero_position: positionSchema,
  hero_hand: heroHandSchema,
  history: historySchema,
  board: z.array(cardSchema).max(MAX_BOARD_CARDS),
  end_reason: previousHandEndSchema,
});

/** A finished hand's row values, validated (throws a ZodError on a malformed hand). */
export type HandRecordValues = z.infer<typeof handRecordValuesSchema>;

export interface HandRecordWrite {
  userId: string;
  sessionId: string;
  attemptId: string;
  values: HandRecordValues;
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

export function handRecordValues(hand: FinishedHand): HandRecordValues {
  return handRecordValuesSchema.parse({
    hand_no: hand.previous.hand_no,
    hero_position: hand.heroPosition,
    hero_hand: hand.heroHand,
    history: hand.previous.history,
    board: hand.previous.board,
    end_reason: hand.previous.end,
  });
}

/**
 * Inserts the finished hand's row inside the decision's transaction; a row whose session hand or
 * attempt is already logged is left as it is (undefined comes back), never an error.
 */
export async function insertHandRecord(transaction: Database, write: HandRecordWrite): Promise<HandRecord | undefined> {
  const { values } = write;
  const row = await transaction
    .insertInto("hand_record")
    .values({
      user_id: write.userId,
      session_id: write.sessionId,
      attempt_id: write.attemptId,
      hand_no: values.hand_no,
      hero_position: values.hero_position,
      hero_hand: values.hero_hand,
      history: toJsonb(values.history),
      board: [...values.board],
      end_reason: values.end_reason,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
  return row === undefined ? undefined : toRecord(row);
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
