/**
 * The counted decisions of a user, grouped in Postgres (R4.11, O-257, O-274, O-275, PR #27 review
 * MEDIUM 10, MEDIUM 12 and LOW 15): the one track-decisions helper the leak stat recompute, the
 * weekly snapshot and the automated queue's track averages share.
 *
 * Mechanism: one query over repository.ts countedAttempts groups the attempts by (class, label,
 * track ids, side of an optional cutoff) and answers each group's count, its summed EV loss (each
 * row's loss clamped at zero first, as solver-query's raw loss_bb may carry a float residue below
 * zero) and its newest attempt. So a decision reads a bounded number of rows (classes x labels)
 * instead of every attempt of its track, and the weekly job reads one query per user instead of
 * three per (user, class). learning does every computation: a group expands to `count` decisions
 * at its mean loss, so classStat, trackAverage and leakStat see the same misses and total loss as
 * over the raw rows (06 section 6; A6 section 1: api never reimplements learning's math).
 */
import {
  classStat,
  trackAverage,
  type ClassStat,
  type GradeLabel,
  type LeakDecision,
  type TrackAverage,
} from "@g-tee-oh/learning";
import { sql } from "kysely";

import type { Database } from "../db.js";
import { UNCLASSIFIED_SPOT_CLASS } from "../grading/decide.js";
import { countedAttempts, gradeLabelOf } from "./repository.js";

/** Counted attempts sharing a class, a label, track ids and a side of the cutoff. */
export interface DecisionGroup {
  spotClassKey: string;
  label: GradeLabel;
  trackIds: readonly string[];
  count: number;
  /** The summed EV loss in bb, each attempt's clamped at zero. */
  lossBb: number;
  newestAt: Date;
  /** Every attempt of the group was made before the scope's cutoff (true without a cutoff). */
  beforeCutoff: boolean;
}

/** Which counted attempts to group: a class, a track (with or instead of the class), a cutoff. */
export interface DecisionScope {
  spotClassKey?: string;
  trackId?: string | null;
  /** Attempts at or after this instant are grouped apart (beforeCutoff false). */
  cutoff?: Date;
}

/** The scope's filter over countedAttempts' rows: the class or the track, either, or every class. */
function scopeFilter(scope: DecisionScope) {
  const trackId = scope.trackId ?? null;
  const inTrack = sql<boolean>`attempt.track_ids @> array[${trackId}]::uuid[]`;
  if (scope.spotClassKey !== undefined) {
    const inClass = sql<boolean>`attempt.spot_class_key = ${scope.spotClassKey}`;
    return trackId === null ? inClass : sql<boolean>`(${inClass} or ${inTrack})`;
  }
  return trackId === null ? sql<boolean>`true` : inTrack;
}

/** The user's counted attempts in `scope`, grouped (see the module doc). One query. */
export async function decisionGroups(database: Database, userId: string, scope: DecisionScope = {}): Promise<DecisionGroup[]> {
  const before = scope.cutoff === undefined ? sql<boolean>`true` : sql<boolean>`attempt.created_at < ${scope.cutoff}`;
  const counted = countedAttempts(database, userId)
    .where(scopeFilter(scope))
    .select([
      "attempt.spot_class_key",
      "attempt.label",
      "attempt.track_ids",
      "attempt.created_at",
      sql<number>`greatest(attempt.ev_loss_bb, 0)::double precision`.as("loss_bb"),
      before.as("before_cutoff"),
    ]);
  const rows = await database
    .selectFrom(counted.as("counted"))
    .select((eb) => [
      "counted.spot_class_key",
      "counted.label",
      "counted.track_ids",
      "counted.before_cutoff",
      eb.fn.countAll<string>().as("count"),
      eb.fn.sum<number>("counted.loss_bb").as("loss_bb"),
      eb.fn.max("counted.created_at").as("newest_at"),
    ])
    .groupBy(["counted.spot_class_key", "counted.label", "counted.track_ids", "counted.before_cutoff"])
    .execute();
  return rows.map((row) => ({
    spotClassKey: row.spot_class_key,
    label: gradeLabelOf(row.label),
    trackIds: row.track_ids ?? [],
    count: Number(row.count),
    lossBb: Number(row.loss_bb ?? 0),
    newestAt: row.newest_at,
    beforeCutoff: row.before_cutoff,
  }));
}

/** The groups as learning's decisions: each group's count of decisions at its mean loss. */
export function decisionsOf(groups: readonly DecisionGroup[]): LeakDecision[] {
  return groups.flatMap((group) => {
    const decision: LeakDecision = { label: group.label, evLossBb: group.lossBb / group.count };
    return Array.from({ length: group.count }, () => decision);
  });
}

/** One class's decisions among the groups. */
export function classDecisionsOf(groups: readonly DecisionGroup[], spotClassKey: string): LeakDecision[] {
  return decisionsOf(groups.filter((group) => group.spotClassKey === spotClassKey));
}

/** learning's raw stat of every classified class whose attempts carry the track. */
export function trackClassStats(groups: readonly DecisionGroup[], trackId: string): ClassStat[] {
  const byClass = new Map<string, DecisionGroup[]>();
  for (const group of groups) {
    if (group.spotClassKey !== UNCLASSIFIED_SPOT_CLASS && group.trackIds.includes(trackId)) {
      byClass.set(group.spotClassKey, [...(byClass.get(group.spotClassKey) ?? []), group]);
    }
  }
  return [...byClass.values()].map((classGroups) => classStat(decisionsOf(classGroups)));
}

/** learning's pooled track average over the track's classes; null when the track has no decisions. */
export function trackAverageOf(groups: readonly DecisionGroup[], trackId: string): TrackAverage | null {
  return trackAverage(trackClassStats(groups, trackId));
}

/** The track of a class: the first track id of its newest group (its newest counted attempt). */
export function classTrackIdOf(groups: readonly DecisionGroup[], spotClassKey: string): string | null {
  const newest = groups
    .filter((group) => group.spotClassKey === spotClassKey)
    .reduce<DecisionGroup | undefined>((best, group) => (best === undefined || group.newestAt > best.newestAt ? group : best), undefined);
  return newest?.trackIds[0] ?? null;
}
