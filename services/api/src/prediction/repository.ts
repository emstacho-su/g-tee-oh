/**
 * prediction_answer rows (R3.16, O-301, A4 section 2): one row per answered prediction prompt,
 * always scoped by user_id. A prediction is never an attempt: nothing here touches the attempt,
 * rating, scheduling or leak tables, so an answer can never move a rating (unrated, 05 section 8).
 * Reads come back oldest first (created_at, then the time-ordered uuidv7 id) for learning's
 * levelFor replay.
 */
import type { PredictionAnswerRecord, PredictionLadder } from "@g-tee-oh/learning";

import type { Database } from "../db.js";
import { predictionLadderSchema } from "../schemas/prediction.js";

export interface NewPredictionAnswer {
  userId: string;
  sessionId: string;
  spotClassKey: string;
  ladder: PredictionLadder;
  level: number;
  correct: boolean;
}

/** The user's answers for one spot class, both ladders, oldest first. */
export async function answerHistory(database: Database, userId: string, spotClassKey: string): Promise<PredictionAnswerRecord[]> {
  const rows = await database
    .selectFrom("prediction_answer")
    .select(["spot_class_key", "ladder", "level", "correct"])
    .where("user_id", "=", userId)
    .where("spot_class_key", "=", spotClassKey)
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows.map((row) => ({
    spotClassKey: row.spot_class_key,
    ladder: predictionLadderSchema.parse(row.ladder),
    level: row.level,
    correct: row.correct,
  }));
}

export async function insertAnswer(database: Database, answer: NewPredictionAnswer): Promise<void> {
  await database
    .insertInto("prediction_answer")
    .values({
      user_id: answer.userId,
      session_id: answer.sessionId,
      spot_class_key: answer.spotClassKey,
      ladder: answer.ladder,
      level: answer.level,
      correct: answer.correct,
    })
    .execute();
}
