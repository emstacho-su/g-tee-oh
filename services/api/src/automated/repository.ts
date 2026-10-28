/**
 * The automated loop's reads (R4.10, O-254, O-255, O-270, O-274, ADR 0001): every query is scoped
 * by user_id. They run on the caller's handle, so inside a decision transaction they see the rows
 * the same transaction wrote (the next pick reads the block close's card, O-272).
 *
 * - queueInputs: the user's schedule cards (learning-state/fsrs-card.ts reads them back), mastery,
 *   leak stats, and per track the pooled average (learning's trackAverage over its classes' stats)
 *   over the attempts leak stats count. It uses the shared track-decisions helper
 *   (learning-state/track-decisions.ts decisionGroups: one grouped query over countedAttempts, drill
 *   and automated, panels hidden, never client-seeded; O-274, O-275, PR #27 review LOW 15).
 * - countEarlierAttemptsAtItem: the first-attempt rule's count over attempt_item_idx (O-274).
 * - blockAttempts: the last n decisions of a session, oldest first: the open block's instances.
 * - uncoveredCardPairs: the (configuration, pair) of the last attempt of each class the user holds
 *   a card for that the catalog no longer lists, within the scope (A6 section 3 step 4, O-270).
 */
import type { GradeLabel, TrackAverage } from "@g-tee-oh/learning";
import { sql } from "kysely";

import type { Database } from "../db.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import { spotClassCardOf } from "../learning-state/fsrs-card.js";
import { gradeLabelOf, trackIdsByKey } from "../learning-state/repository.js";
import { decisionGroups, trackAverageOf, type DecisionGroup } from "../learning-state/track-decisions.js";
import type { PairCandidate } from "../sessions/candidates.js";
import type { ClassCatalog } from "./class-catalog.js";
import type { QueueInputs } from "./queue.js";

/** Per track key, learning's pooled average over its classes; null for a track with no decisions. */
export function trackAveragesOf(groups: readonly DecisionGroup[], trackIds: ReadonlyMap<TrackKey, string>): Map<TrackKey, TrackAverage | null> {
  return new Map(
    TRACK_KEYS.map((key) => {
      const trackId = trackIds.get(key);
      return [key, trackId === undefined ? null : trackAverageOf(groups, trackId)];
    }),
  );
}

export async function queueInputs(database: Database, userId: string): Promise<QueueInputs> {
  const [cards, mastery, leaks, groups, trackIds] = await Promise.all([
    database.selectFrom("schedule_card").select(["spot_class_key", "fsrs_state"]).where("user_id", "=", userId).execute(),
    database.selectFrom("mastery").select(["spot_class_key", "p_known"]).where("user_id", "=", userId).execute(),
    database.selectFrom("leak_stat").select(["spot_class_key", "leak_cost_bb_per_1k"]).where("user_id", "=", userId).execute(),
    decisionGroups(database, userId),
    trackIdsByKey(database),
  ]);
  return {
    cards: new Map(cards.map((row) => [row.spot_class_key, spotClassCardOf(row.spot_class_key, row.fsrs_state)])),
    pKnown: new Map(mastery.map((row) => [row.spot_class_key, row.p_known])),
    leakCosts: new Map(leaks.map((row) => [row.spot_class_key, row.leak_cost_bb_per_1k])),
    trackAverages: trackAveragesOf(groups, trackIds),
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

export interface BlockAttempt {
  score: number;
  responseMs: number;
  label: GradeLabel;
}

/** The session's last `count` decisions, oldest first. */
export async function blockAttempts(database: Database, sessionId: string, count: number): Promise<BlockAttempt[]> {
  const rows = await database
    .selectFrom("attempt")
    .select(["score", "response_ms", "label"])
    .where("session_id", "=", sessionId)
    .orderBy("state_version", "desc")
    .limit(count)
    .execute();
  return rows.reverse().map((row) => ({
    score: row.score,
    responseMs: row.response_ms ?? 0,
    label: gradeLabelOf(row.label),
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
