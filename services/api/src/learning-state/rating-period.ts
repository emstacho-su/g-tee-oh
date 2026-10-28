/**
 * The session-end rating period (R4.11, O-27, O-251, O-259, ADR 0011): one Glicko-2 period per track
 * the session rated, written as the track's rating and one rating_history row tagged with the
 * session, inside the end transaction.
 *
 * Mechanism:
 * - The session's rated attempts (rated is false for drill, holdout, worked-example, excluded and
 *   client-seeded decisions) are grouped by the track ids each carries. A track without one is
 *   untouched. Each rated decision is a result against its item at item_difficulty (O-250); a rated
 *   attempt without a stored difficulty carries no opponent and is left out.
 * - Per track, in TRACK_KEYS order: the stored rating (or learning's newTrackRating) first takes
 *   applyInactivity(inactivePeriods(days since rating.updated_at)) (O-251, O-259), then
 *   rateSession over the decisions; the rating is upserted with updated_at now and one history row
 *   is inserted with recorded_at now, so the rating row and its newest history row always agree.
 * - Idempotent by session: when the session already has history rows the period is not run again.
 *   Both a first and a repeat call answer sessionRatingChanges, read back from the rows: after is
 *   the session's history row, before is the track's previous history row with the inactivity of
 *   the gap between the two (null for a first rating). So a repeat end answers the same recap.
 * - ratingOnRead is the read path's figure (progress, holdout summaries): inactivity applied as of
 *   now, never written.
 */
import {
  applyInactivity,
  inactivePeriods,
  newTrackRating,
  rateSession,
  type SessionDecision,
  type TrackRating,
} from "@g-tee-oh/learning";
import type { z } from "zod";

import type { Database } from "../db.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";
import type { recapSchema } from "../schemas/training.js";
import { trackKeysById } from "./repository.js";

export type RatingChange = z.infer<typeof recapSchema>["rating_changes"][number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NO_DAYS = 0;

/** A stored rating row as the read path holds it. */
export interface StoredRating {
  mu: number;
  rd: number;
  volatility: number;
  updatedAt: Date;
}

export interface RateSessionRequest {
  userId: string;
  sessionId: string;
  now: Date;
}

/** The stored rating with the inactivity of the time since its update applied, never written (O-251). */
export function ratingOnRead(row: StoredRating, now: Date): TrackRating {
  const days = Math.max(NO_DAYS, (now.getTime() - row.updatedAt.getTime()) / MS_PER_DAY);
  return applyInactivity({ rating: row.mu, rd: row.rd, volatility: row.volatility }, inactivePeriods(days));
}

function trackOrder(key: TrackKey): number {
  return TRACK_KEYS.indexOf(key);
}

async function ratedDecisionsByTrack(database: Database, request: RateSessionRequest): Promise<Map<string, SessionDecision[]>> {
  const rows = await database
    .selectFrom("attempt")
    .select(["track_ids", "item_difficulty", "score", "weight"])
    .where("session_id", "=", request.sessionId)
    .where("user_id", "=", request.userId)
    .where("rated", "=", true)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const byTrack = new Map<string, SessionDecision[]>();
  for (const row of rows) {
    if (row.item_difficulty === null) {
      continue;
    }
    const decision: SessionDecision = { difficulty: row.item_difficulty, score: row.score, rated: true, weight: row.weight };
    for (const trackId of row.track_ids ?? []) {
      byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), decision]);
    }
  }
  return byTrack;
}

async function rateTrack(
  database: Database,
  request: RateSessionRequest,
  trackId: string,
  decisions: readonly SessionDecision[],
): Promise<void> {
  const stored = await database
    .selectFrom("rating")
    .select(["mu", "rd", "volatility", "updated_at"])
    .where("user_id", "=", request.userId)
    .where("track_id", "=", trackId)
    .forUpdate()
    .executeTakeFirst();
  const player =
    stored === undefined
      ? newTrackRating()
      : ratingOnRead({ mu: stored.mu, rd: stored.rd, volatility: stored.volatility, updatedAt: stored.updated_at }, request.now);
  const after = rateSession(player, decisions);
  const values = { mu: after.rating, rd: after.rd, volatility: after.volatility, updated_at: request.now };
  await database
    .insertInto("rating")
    .values({ user_id: request.userId, track_id: trackId, ...values })
    .onConflict((conflict) => conflict.columns(["user_id", "track_id"]).doUpdateSet(values))
    .execute();
  await database
    .insertInto("rating_history")
    .values({
      user_id: request.userId,
      track_id: trackId,
      session_id: request.sessionId,
      mu: after.rating,
      rd: after.rd,
      volatility: after.volatility,
      recorded_at: request.now,
    })
    .execute();
}

interface HistoryRow {
  track_id: string | null;
  mu: number | null;
  rd: number | null;
  volatility: number | null;
  recorded_at: Date;
}

async function previousHistory(database: Database, userId: string, row: HistoryRow): Promise<HistoryRow | undefined> {
  if (row.track_id === null) {
    return undefined;
  }
  return database
    .selectFrom("rating_history")
    .select(["track_id", "mu", "rd", "volatility", "recorded_at"])
    .where("user_id", "=", userId)
    .where("track_id", "=", row.track_id)
    .where("recorded_at", "<", row.recorded_at)
    .orderBy("recorded_at", "desc")
    .limit(1)
    .executeTakeFirst();
}

function beforeOf(previous: HistoryRow | undefined, at: Date): RatingChange["before"] {
  if (previous === undefined || previous.mu === null || previous.rd === null || previous.volatility === null) {
    return null;
  }
  const figure = ratingOnRead({ mu: previous.mu, rd: previous.rd, volatility: previous.volatility, updatedAt: previous.recorded_at }, at);
  return { mu: figure.rating, rd: figure.rd };
}

/** The session's rating changes, read back from rating_history (see the module doc). */
export async function sessionRatingChanges(database: Database, request: Omit<RateSessionRequest, "now">): Promise<RatingChange[]> {
  const rows = await database
    .selectFrom("rating_history")
    .select(["track_id", "mu", "rd", "volatility", "recorded_at"])
    .where("user_id", "=", request.userId)
    .where("session_id", "=", request.sessionId)
    .execute();
  const keys = await trackKeysById(database);
  const changes: RatingChange[] = [];
  for (const row of rows) {
    const key = row.track_id === null ? undefined : keys.get(row.track_id);
    if (key === undefined || row.mu === null || row.rd === null) {
      continue;
    }
    const previous = await previousHistory(database, request.userId, row);
    changes.push({ track_key: key, before: beforeOf(previous, row.recorded_at), after: { mu: row.mu, rd: row.rd } });
  }
  return changes.sort((left, right) => trackOrder(left.track_key) - trackOrder(right.track_key));
}

async function alreadyRated(database: Database, request: RateSessionRequest): Promise<boolean> {
  const row = await database
    .selectFrom("rating_history")
    .select("session_id")
    .where("user_id", "=", request.userId)
    .where("session_id", "=", request.sessionId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * The pinned cross-lane entry point (S31-lanes.md): runs the session's rating period once per track
 * it rated and answers the recap's rating_changes; a repeat call writes nothing and answers the same.
 */
export async function rateSessionTracks(transaction: Database, request: RateSessionRequest): Promise<RatingChange[]> {
  if (!(await alreadyRated(transaction, request))) {
    const byTrack = await ratedDecisionsByTrack(transaction, request);
    const keys = await trackKeysById(transaction);
    const ordered = [...byTrack.keys()]
      .flatMap((trackId) => {
        const key = keys.get(trackId);
        return key === undefined ? [] : [{ trackId, key }];
      })
      .sort((left, right) => trackOrder(left.key) - trackOrder(right.key));
    for (const { trackId } of ordered) {
      await rateTrack(transaction, request, trackId, byTrack.get(trackId) ?? []);
    }
  }
  return sessionRatingChanges(transaction, request);
}
