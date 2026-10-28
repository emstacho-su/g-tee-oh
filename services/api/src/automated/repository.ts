/**
 * The automated loop's reads (R4.10, O-254, O-255, O-270, O-274, ADR 0001): every query is scoped
 * by user_id. They run on the caller's handle, so inside a decision transaction they see the rows
 * the same transaction wrote (the next pick reads the block close's card, O-272).
 *
 * - queueInputs: the user's schedule cards (learning-state/fsrs-card.ts reads them back), mastery,
 *   leak stats, and per track the pooled average (learning's classStat per class, then
 *   trackAverage) over the attempts leak stats count (learning-state/repository.ts countedAttempts:
 *   drill and automated, panels hidden, never client-seeded; O-274, O-275).
 * - countEarlierAttemptsAtItem: the first-attempt rule's count over attempt_item_idx (O-274).
 * - countRatedTodayInTrack: rated attempts since local midnight carrying the track (O-274, O-247).
 * - blockAttempts: the last n decisions of a session, oldest first: the open block's instances.
 * - uncoveredCardPairs: the (configuration, pair) of the last attempt of each class the user holds
 *   a card for that the catalog no longer lists, within the scope (A6 section 3 step 4, O-270).
 */
import { classStat, trackAverage, type ClassStat, type Confidence, type GradeLabel, type TrackAverage } from "@g-tee-oh/learning";
import { sql } from "kysely";

import type { Database } from "../db.js";
import { UNCLASSIFIED_SPOT_CLASS } from "../grading/decide.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import { spotClassCardOf } from "../learning-state/fsrs-card.js";
import { countedAttempts, gradeLabelOf } from "../learning-state/repository.js";
import type { PairCandidate } from "../sessions/candidates.js";
import type { ClassCatalog } from "./class-catalog.js";
import type { QueueInputs } from "./queue.js";

const CONFIDENCES: readonly Confidence[] = ["sure", "unsure"];
/** solver-query's loss is raw; a float residue below zero reads as no loss (as leak-stat.ts does). */
const NO_LOSS_BB = 0;

export function confidenceOf(stored: string | null): Confidence | null {
  return CONFIDENCES.find((confidence) => confidence === stored) ?? null;
}

export interface LeakAttempt {
  spot_class_key: string;
  track_key: string;
  label: string;
  ev_loss_bb: number;
}

async function leakAttempts(database: Database, userId: string): Promise<LeakAttempt[]> {
  return countedAttempts(database, userId)
    .innerJoin("track", (join) => join.on(sql<boolean>`track.id = any(attempt.track_ids)`))
    .select(["attempt.spot_class_key", "track.key as track_key", "attempt.label", "attempt.ev_loss_bb"])
    .where("attempt.spot_class_key", "<>", UNCLASSIFIED_SPOT_CLASS)
    .execute();
}

/** Per track, learning's pooled average over its classes' raw stats; null for a track with no decisions. */
export function trackAveragesOf(attempts: readonly LeakAttempt[]): Map<TrackKey, TrackAverage | null> {
  const byTrack = new Map<string, Map<string, LeakAttempt[]>>();
  for (const attempt of attempts) {
    const classes = byTrack.get(attempt.track_key) ?? new Map<string, LeakAttempt[]>();
    classes.set(attempt.spot_class_key, [...(classes.get(attempt.spot_class_key) ?? []), attempt]);
    byTrack.set(attempt.track_key, classes);
  }
  return new Map(
    TRACK_KEYS.map((key) => {
      const classes = [...(byTrack.get(key)?.values() ?? [])];
      const stats: ClassStat[] = classes.map((rows) =>
        classStat(rows.map((row) => ({ label: gradeLabelOf(row.label), evLossBb: Math.max(NO_LOSS_BB, row.ev_loss_bb) }))),
      );
      return [key, trackAverage(stats)];
    }),
  );
}

export async function queueInputs(database: Database, userId: string): Promise<QueueInputs> {
  const [cards, mastery, leaks, attempts] = await Promise.all([
    database.selectFrom("schedule_card").select(["spot_class_key", "fsrs_state"]).where("user_id", "=", userId).execute(),
    database.selectFrom("mastery").select(["spot_class_key", "p_known"]).where("user_id", "=", userId).execute(),
    database.selectFrom("leak_stat").select(["spot_class_key", "leak_cost_bb_per_1k"]).where("user_id", "=", userId).execute(),
    leakAttempts(database, userId),
  ]);
  return {
    cards: new Map(cards.map((row) => [row.spot_class_key, spotClassCardOf(row.spot_class_key, row.fsrs_state)])),
    pKnown: new Map(mastery.map((row) => [row.spot_class_key, row.p_known])),
    leakCosts: new Map(leaks.map((row) => [row.spot_class_key, row.leak_cost_bb_per_1k])),
    trackAverages: trackAveragesOf(attempts),
  };
}

export interface ItemKey {
  solutionId: string;
  nodeKey: string;
  handClass: string | null;
}

export async function countEarlierAttemptsAtItem(database: Database, userId: string, item: ItemKey): Promise<number> {
  const row = await database
    .selectFrom("attempt")
    .select((eb) => eb.fn.countAll<string>().as("earlier"))
    .where("user_id", "=", userId)
    .where("solution_id", "=", item.solutionId)
    .where("node_key", "=", item.nodeKey)
    .where(sql<boolean>`hand_class is not distinct from ${item.handClass}`)
    .executeTakeFirstOrThrow();
  return Number(row.earlier);
}

/** Rated attempts of the user in the track since midnight in `timeZone`, as of `now` (O-274, O-247). */
export async function countRatedTodayInTrack(
  database: Database,
  userId: string,
  trackKey: TrackKey,
  clock: { now: Date; timeZone: string },
): Promise<number> {
  const { now, timeZone } = clock;
  const row = await database
    .selectFrom("attempt")
    .innerJoin("track", (join) => join.on(sql<boolean>`track.id = any(attempt.track_ids)`))
    .select((eb) => eb.fn.countAll<string>().as("rated"))
    .where("attempt.user_id", "=", userId)
    .where("track.key", "=", trackKey)
    .where("attempt.rated", "=", true)
    .where("attempt.created_at", "<=", now)
    .where(
      "attempt.created_at",
      ">=",
      sql<Date>`(date_trunc('day', cast(${now.toISOString()} as timestamptz) at time zone ${timeZone}) at time zone ${timeZone})`,
    )
    .executeTakeFirstOrThrow();
  return Number(row.rated);
}

export interface BlockAttempt {
  score: number;
  responseMs: number;
  label: GradeLabel;
  confidence: Confidence | null;
}

/** The session's last `count` decisions, oldest first. */
export async function blockAttempts(database: Database, sessionId: string, count: number): Promise<BlockAttempt[]> {
  const rows = await database
    .selectFrom("attempt")
    .select(["score", "response_ms", "label", "confidence"])
    .where("session_id", "=", sessionId)
    .orderBy("state_version", "desc")
    .limit(count)
    .execute();
  return rows.reverse().map((row) => ({
    score: row.score,
    responseMs: row.response_ms ?? 0,
    label: gradeLabelOf(row.label),
    confidence: confidenceOf(row.confidence),
  }));
}

/**
 * The pairs to request for classes the user holds a card for that the catalog does not list (O-270):
 * each such class's last attempt's solution names its configuration and pair. Only configurations
 * in scope count (an empty scope is every configuration); the caller dedupes against the catalog's
 * own gaps.
 */
export async function uncoveredCardPairs(
  database: Database,
  userId: string,
  catalog: ClassCatalog,
  configIds: readonly string[],
): Promise<PairCandidate[]> {
  const cards = await database.selectFrom("schedule_card").select("spot_class_key").where("user_id", "=", userId).execute();
  const missing = cards.map((card) => card.spot_class_key).filter((key) => !catalog.byKey.has(key));
  if (missing.length === 0) {
    return [];
  }
  const rows = await database
    .selectFrom("attempt")
    .innerJoin("solution", "solution.id", "attempt.solution_id")
    .select(["attempt.spot_class_key", "solution.game_config_id", "solution.position_pair"])
    .distinctOn("attempt.spot_class_key")
    .where("attempt.user_id", "=", userId)
    .where("attempt.spot_class_key", "in", missing)
    .orderBy("attempt.spot_class_key")
    .orderBy("attempt.created_at", "desc")
    .execute();
  const pairs = rows.flatMap((row) =>
    row.position_pair === null || (configIds.length > 0 && !configIds.includes(row.game_config_id))
      ? []
      : [{ config_id: row.game_config_id, pair: row.position_pair }],
  );
  return dedupePairs(pairs);
}

export function dedupePairs(pairs: readonly PairCandidate[]): PairCandidate[] {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.config_id}/${pair.pair}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
