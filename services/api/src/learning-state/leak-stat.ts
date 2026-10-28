/**
 * leak_stat per spot class (R4.11, O-255, O-257, O-274, O-275, 06 section 6): recomputed from the
 * stored attempts, never accumulated, so a recompute is a function of the rows and running it twice
 * writes the same row (the weekly job's idempotence, PM condition).
 *
 * Mechanism: the class's decisions are its counted attempts (repository.ts countedAttempts: drill and
 * automated, panels hidden, never client-seeded). The track average the shrinkage pulls toward is
 * learning's trackAverage over every class of the track (attempts carrying the track's id in
 * track_ids, the unclassified key left out); a class with no track, or a track with no counted
 * decisions, shrinks toward its own raw stat, which leaves it unshrunk. learning's leakStat makes
 * the row with the frequency prior the caller passes (the class catalog's, O-270). A class with no
 * counted decision writes nothing: its cost stays the queue's startingLeakCost (O-255).
 * solver-query's loss_bb is raw and never clamped, so a float residue below zero reads as no loss.
 */
import { classStat, leakStat, trackAverage, type LeakDecision, type LeakStat, type TrackAverage } from "@g-tee-oh/learning";
import { sql } from "kysely";

import type { Database } from "../db.js";
import { UNCLASSIFIED_SPOT_CLASS } from "../grading/decide.js";
import type { TrackKey } from "../learning/tracks.js";
import { countedAttempts, gradeLabelOf, trackIdOf } from "./repository.js";

/** The pinned cross-lane request (S31-lanes.md): the class, its track and its catalog prior. */
export interface LeakStatRequest {
  userId: string;
  spotClassKey: string;
  trackKey: TrackKey | null;
  frequencyPriorPer1k: number;
  now: Date;
}

/** The same request with the track already resolved to its id (the weekly job reads ids). */
export interface LeakStatByIdRequest {
  userId: string;
  spotClassKey: string;
  trackId: string | null;
  frequencyPriorPer1k: number;
  now: Date;
}

const NO_LOSS_BB = 0;

interface DecisionRow {
  spot_class_key: string;
  label: string;
  ev_loss_bb: number;
}

function decisionOf(row: DecisionRow): LeakDecision {
  return { label: gradeLabelOf(row.label), evLossBb: Math.max(NO_LOSS_BB, row.ev_loss_bb) };
}

async function classDecisions(database: Database, userId: string, spotClassKey: string): Promise<LeakDecision[]> {
  const rows = await countedAttempts(database, userId)
    .select(["attempt.spot_class_key", "attempt.label", "attempt.ev_loss_bb"])
    .where("attempt.spot_class_key", "=", spotClassKey)
    .execute();
  return rows.map(decisionOf);
}

async function trackDecisionsByClass(database: Database, userId: string, trackId: string): Promise<Map<string, LeakDecision[]>> {
  const rows = await countedAttempts(database, userId)
    .select(["attempt.spot_class_key", "attempt.label", "attempt.ev_loss_bb"])
    .where("attempt.spot_class_key", "!=", UNCLASSIFIED_SPOT_CLASS)
    .where(sql<boolean>`attempt.track_ids @> array[${trackId}]::uuid[]`)
    .execute();
  const byClass = new Map<string, LeakDecision[]>();
  for (const row of rows) {
    byClass.set(row.spot_class_key, [...(byClass.get(row.spot_class_key) ?? []), decisionOf(row)]);
  }
  return byClass;
}

/** The average the class shrinks toward: its track's, or its own raw stat without one. */
async function shrinkTarget(
  database: Database,
  request: LeakStatByIdRequest,
  decisions: readonly LeakDecision[],
): Promise<TrackAverage> {
  const own = classStat(decisions);
  const ownAverage: TrackAverage = { missRate: own.missRate, evPerMissBb: own.evPerMissBb };
  if (request.trackId === null) {
    return ownAverage;
  }
  const byClass = await trackDecisionsByClass(database, request.userId, request.trackId);
  return trackAverage([...byClass.values()].map((classDecisionList) => classStat(classDecisionList))) ?? ownAverage;
}

async function upsertLeakStat(database: Database, userId: string, stat: LeakStat, now: Date): Promise<void> {
  const values = {
    freq_prior_per_1k: stat.freqPriorPer1k,
    freq_personal_per_1k: stat.freqPersonalPer1k,
    n: stat.n,
    miss_rate: stat.missRate,
    ev_per_miss_bb: stat.evPerMissBb,
    leak_cost_bb_per_1k: stat.leakCostBbPer1k,
    computed_at: now,
  };
  await database
    .insertInto("leak_stat")
    .values({ user_id: userId, spot_class_key: stat.spotClassKey, ...values })
    .onConflict((conflict) => conflict.columns(["user_id", "spot_class_key"]).doUpdateSet(values))
    .execute();
}

/** Recomputes and writes one class's row; undefined (and no write) when it has no counted decision. */
export async function recomputeLeakStatById(database: Database, request: LeakStatByIdRequest): Promise<LeakStat | undefined> {
  const decisions = await classDecisions(database, request.userId, request.spotClassKey);
  if (decisions.length === 0) {
    return undefined;
  }
  const track = await shrinkTarget(database, request, decisions);
  const stat = leakStat(request.spotClassKey, request.frequencyPriorPer1k, decisions, track);
  await upsertLeakStat(database, request.userId, stat, request.now);
  return stat;
}

/** The pinned cross-lane entry point (S31-lanes.md): recompute the class's leak_stat row (O-275). */
export async function recomputeLeakStat(transaction: Database, request: LeakStatRequest): Promise<void> {
  const trackId = request.trackKey === null ? null : await trackIdOf(transaction, request.trackKey);
  await recomputeLeakStatById(transaction, { ...request, trackId });
}

/** The stored prior of a class, for a class the catalog no longer lists (O-270); undefined without a row. */
export async function storedFrequencyPrior(database: Database, userId: string, spotClassKey: string): Promise<number | undefined> {
  const row = await database
    .selectFrom("leak_stat")
    .select("freq_prior_per_1k")
    .where("user_id", "=", userId)
    .where("spot_class_key", "=", spotClassKey)
    .executeTakeFirst();
  return row?.freq_prior_per_1k;
}
