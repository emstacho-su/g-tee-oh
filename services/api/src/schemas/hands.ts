/**
 * The hand log's read shape (R3.13, S40, O-352, O-403): one finished hand of a session as
 * GET /sessions/{id}/hands answers it. hand_no, history, board and end are exactly the hand's
 * previous_hand (the record is written from it, O-400); the hero's seat and hole cards and the
 * attempt that ended the hand are the O-401 additions.
 */
import { z } from "zod";

import { cardSchema, positionSchema, uuidSchema } from "./common.js";
import { previousHandEndSchema, previousHandSchema } from "./training.js";

export const handRecordSchema = z
  .object({
    hand_no: previousHandSchema.shape.hand_no,
    history: previousHandSchema.shape.history,
    board: previousHandSchema.shape.board,
    end: previousHandEndSchema,
    hero_position: positionSchema,
    hero_hand: z.array(cardSchema).length(2).describe("The hero's hole cards"),
    attempt_id: uuidSchema.describe("The decision that ended the hand"),
    created_at: z.iso.datetime().describe("When the deciding attempt was stored"),
  })
  .meta({ id: "HandRecord" });

export type HandRecordView = z.infer<typeof handRecordSchema>;

/** The cursor of the hands list: the last hand number on the page. */
export const handCursorSchema = z.strictObject({ hand_no: z.number().int().min(0) });
