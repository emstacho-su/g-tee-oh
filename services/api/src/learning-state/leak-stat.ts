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
 *
 * PR #27 review MEDIUM 12: the class and its track are read in one grouped query
 * (track-decisions.ts), so a decision transfers classes x labels rows rather than every attempt of
 * the track, and the track id comes from the cached track map: a decision's recompute is two
 * statements (the grouped read and the upsert), down from four plus a track read per call.
 */
import { classStat, leakStat, type LeakStat, type TrackAverage } from "@g-tee-oh/learning";

import type { Database } from "../db.js";
import type { TrackKey } from "../learning/tracks.js";
import { trackIdOf } from "./repository.js";
import { classDecisionsOf, decisionGroups, trackAverageOf, type DecisionGroup } from "./track-decisions.js";

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

/** The class's row over already grouped decisions; undefined when the class has none. */
export function leakStatOf(
  groups: readonly DecisionGroup[],
  request: Pick<LeakStatByIdRequest, "spotClassKey" | "trackId" | "frequencyPriorPer1k">,
): LeakStat | undefined {
  const decisions = classDecisionsOf(groups, request.spotClassKey);
  if (decisions.length === 0) {
    return undefined;
  }
  const own = classStat(decisions);
  const ownAverage: TrackAverage = { missRate: own.missRate, evPerMissBb: own.evPerMissBb };
  const track = request.trackId === null ? ownAverage : (trackAverageOf(groups, request.trackId) ?? ownAverage);
  return leakStat(request.spotClassKey, request.frequencyPriorPer1k, decisions, track);
}

function rowValues(stat: LeakStat, now: Date) {
  return {
    freq_prior_per_1k: stat.freqPriorPer1k,
    freq_personal_per_1k: stat.freqPersonalPer1k,
    n: stat.n,
    miss_rate: stat.missRate,
    ev_per_miss_bb: stat.evPerMissBb,
    leak_cost_bb_per_1k: stat.leakCostBbPer1k,
    computed_at: now,
  };
}

/** Upserts the user's rows in one statement (the weekly job writes a user's classes together). */
export async function upsertLeakStats(database: Database, userId: string, stats: readonly LeakStat[], now: Date): Promise<void> {
  if (stats.length === 0) {
    return;
  }
  await database
    .insertInto("leak_stat")
    .values(stats.map((stat) => ({ user_id: userId, spot_class_key: stat.spotClassKey, ...rowValues(stat, now) })))
    .onConflict((conflict) =>
      conflict.columns(["user_id", "spot_class_key"]).doUpdateSet((eb) => ({
        freq_prior_per_1k: eb.ref("excluded.freq_prior_per_1k"),
        freq_personal_per_1k: eb.ref("excluded.freq_personal_per_1k"),
        n: eb.ref("excluded.n"),
        miss_rate: eb.ref("excluded.miss_rate"),
        ev_per_miss_bb: eb.ref("excluded.ev_per_miss_bb"),
        leak_cost_bb_per_1k: eb.ref("excluded.leak_cost_bb_per_1k"),
        computed_at: eb.ref("excluded.computed_at"),
      })),
    )
    .execute();
}

/** Recomputes and writes one class's row; undefined (and no write) when it has no counted decision. */
export async function recomputeLeakStatById(database: Database, request: LeakStatByIdRequest): Promise<LeakStat | undefined> {
  const groups = await decisionGroups(database, request.userId, { spotClassKey: request.spotClassKey, trackId: request.trackId });
  const stat = leakStatOf(groups, request);
  if (stat !== undefined) {
    await upsertLeakStats(database, request.userId, [stat], request.now);
  }
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
