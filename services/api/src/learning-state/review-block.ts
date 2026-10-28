/**
 * The review block close (R4.11, O-272, O-273, ADR 0012, 06 sections 4 and 5): when an automated
 * review block ends (all its instances served, or the session ended mid-block), its class gets one
 * FSRS review and its BKT mastery the block's instances, written together, once.
 *
 * Mechanism:
 * - Worked example (a first exposure, every panel visible, unrated): no FSRS or BKT observation. The
 *   class gets learning's newSpotClassCard due now and mastery at learning's prior (newMastery). An
 *   existing card or mastery row is kept (insert on conflict do nothing): a worked example only
 *   happens without a card, and a race must never reset what was learned.
 * - Otherwise: grade = learning's reviewGrade over the block's scores and response times against
 *   the typical response time (typical-time.ts, O-273); the card (stored, or newSpotClassCard) is
 *   reviewed with reviewSpotClass at the retention retentionFor(isMastered(mastery before the
 *   block)) (O-253); mastery folds learning's updateMastery over the instances in order, each
 *   observed with observationFromLabel. Card, due and mastery are upserted.
 * - A block with no attempts (a session ended before any decision in it) reviews nothing and writes
 *   nothing; it reports the stored state.
 * The return value is the feedback's review_block (schemas/training.ts reviewBlockSchema).
 */
import {
  isMastered,
  newMastery,
  newSpotClassCard,
  observationFromLabel,
  retentionFor,
  reviewGrade,
  reviewSpotClass,
  updateMastery,
  type FsrsGrade,
  type Mastery,
  type SpotClassCard,
} from "@g-tee-oh/learning";
import { sql, type Selectable } from "kysely";
import type { z } from "zod";

import type { DB } from "@g-tee-oh/contracts";

import type { Database } from "../db.js";
import type { reviewBlockSchema } from "../schemas/training.js";
import { spotClassCardOf, storedCardOf } from "./fsrs-card.js";
import { gradeLabelOf } from "./repository.js";
import { typicalResponseMs } from "./typical-time.js";

export type ReviewBlockExtras = z.infer<typeof reviewBlockSchema>;
type Json = Selectable<DB["schedule_card"]>["fsrs_state"];

/** One served instance of the block: its score, response time and label (stored or learning form). */
export interface BlockAttempt {
  score: number;
  responseMs: number;
  label: string;
}

/** The pinned cross-lane input (S31-lanes.md). */
export interface ReviewBlockInput {
  userId: string;
  spotClassKey: string;
  workedExample: boolean;
  attempts: readonly BlockAttempt[];
  now: Date;
}

interface StoredLearning {
  card: SpotClassCard | null;
  mastery: Mastery | null;
}

async function readStored(database: Database, userId: string, spotClassKey: string): Promise<StoredLearning> {
  const card = await database
    .selectFrom("schedule_card")
    .select("fsrs_state")
    .where("user_id", "=", userId)
    .where("spot_class_key", "=", spotClassKey)
    .forUpdate()
    .executeTakeFirst();
  const mastery = await database
    .selectFrom("mastery")
    .select("p_known")
    .where("user_id", "=", userId)
    .where("spot_class_key", "=", spotClassKey)
    .forUpdate()
    .executeTakeFirst();
  return {
    card: card === undefined ? null : spotClassCardOf(spotClassKey, card.fsrs_state),
    mastery: mastery === undefined ? null : { pKnown: mastery.p_known },
  };
}

async function writeCard(database: Database, userId: string, card: SpotClassCard, keepExisting: boolean): Promise<void> {
  const values = { fsrs_state: sql<Json>`cast(${JSON.stringify(storedCardOf(card))} as jsonb)`, due: card.card.due };
  await database
    .insertInto("schedule_card")
    .values({ user_id: userId, spot_class_key: card.spotClassKey, ...values })
    .onConflict((conflict) => {
      const target = conflict.columns(["user_id", "spot_class_key"]);
      return keepExisting ? target.doNothing() : target.doUpdateSet(values);
    })
    .execute();
}

async function writeMastery(
  database: Database,
  request: { userId: string; spotClassKey: string; mastery: Mastery; now: Date; keepExisting: boolean },
): Promise<void> {
  const values = { p_known: request.mastery.pKnown, updated_at: request.now };
  await database
    .insertInto("mastery")
    .values({ user_id: request.userId, spot_class_key: request.spotClassKey, ...values })
    .onConflict((conflict) => {
      const target = conflict.columns(["user_id", "spot_class_key"]);
      return request.keepExisting ? target.doNothing() : target.doUpdateSet(values);
    })
    .execute();
}

function extrasOf(spotClassKey: string, grade: FsrsGrade | null, stored: StoredLearning): ReviewBlockExtras {
  return {
    spot_class_key: spotClassKey,
    closed: true,
    fsrs_grade: grade,
    next_due: stored.card === null ? null : stored.card.card.due.toISOString(),
    p_known: stored.mastery?.pKnown ?? null,
  };
}

async function closeWorkedExample(transaction: Database, input: ReviewBlockInput): Promise<ReviewBlockExtras> {
  const card = newSpotClassCard(input.spotClassKey, input.now);
  const mastery = newMastery();
  await writeCard(transaction, input.userId, card, true);
  await writeMastery(transaction, { ...input, mastery, keepExisting: true });
  return extrasOf(input.spotClassKey, null, await readStored(transaction, input.userId, input.spotClassKey));
}

function masteryAfter(before: Mastery, attempts: readonly BlockAttempt[]): Mastery {
  return attempts.reduce<Mastery>(
    (mastery, attempt) => updateMastery(mastery, observationFromLabel(gradeLabelOf(attempt.label))).mastery,
    before,
  );
}

async function closeReview(transaction: Database, input: ReviewBlockInput, stored: StoredLearning): Promise<ReviewBlockExtras> {
  const typical = await typicalResponseMs(transaction, {
    userId: input.userId,
    spotClassKey: input.spotClassKey,
    blockSize: input.attempts.length,
  });
  const grade = reviewGrade({
    scores: input.attempts.map((attempt) => attempt.score),
    responseMs: input.attempts.map((attempt) => attempt.responseMs),
    typicalResponseMs: typical,
  });
  const before = stored.mastery ?? newMastery();
  const card = reviewSpotClass(stored.card ?? newSpotClassCard(input.spotClassKey, input.now), grade, input.now, {
    requestRetention: retentionFor(isMastered(before)),
  });
  const mastery = masteryAfter(before, input.attempts);
  await writeCard(transaction, input.userId, card, false);
  await writeMastery(transaction, { ...input, mastery, keepExisting: false });
  return extrasOf(input.spotClassKey, grade, { card, mastery });
}

/** Closes one review block in the caller's transaction and returns the feedback's review_block (O-272). */
export async function closeReviewBlock(transaction: Database, input: ReviewBlockInput): Promise<ReviewBlockExtras> {
  if (input.workedExample) {
    return closeWorkedExample(transaction, input);
  }
  const stored = await readStored(transaction, input.userId, input.spotClassKey);
  if (input.attempts.length === 0) {
    return extrasOf(input.spotClassKey, null, stored);
  }
  return closeReview(transaction, input, stored);
}
