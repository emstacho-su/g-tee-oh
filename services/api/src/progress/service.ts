/**
 * The six progress reads (R4.12, O-271 to O-279, A5 section 3): each composes the user's rows
 * (progress/repository.ts, holdout/repository.ts, streaks/repository.ts) with the pure aggregations
 * (weights, rating, leaks, heatmap) and returns the contract's shape. Nothing writes; tiers, weights
 * and streaks are recomputed on every read (O-252, O-278). The rating, tracks, leaks and heat map
 * read the class catalog (all catalog configurations), so they need solver-query (503 without it).
 */
import { conservativeRating, newTrackRating } from "@g-tee-oh/learning";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { loadClassCatalog, type ClassCatalog } from "../automated/class-catalog.js";
import type { Database } from "../db.js";
import { itemTotals, roundsPage, type HoldoutRound } from "../holdout/repository.js";
import { roundScores } from "../holdout/results.js";
import { summariesOf } from "../holdout/summaries.js";
import { decodeCursor, paginate } from "../http/cursor.js";
import { requireDatabase } from "../http/database.js";
import type { PageQuery } from "../http/pagination.js";
import { trackDefinition, TRACK_KEYS } from "../learning/tracks.js";
import type { holdoutSchema, ratingSchema, tracksSchema } from "../schemas/insights.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { localDay } from "../streaks/calendar.js";
import { enabledTrackWeights, streakView, type StreakView } from "../streaks/repository.js";
import { heatmapOf, type Heatmap } from "./heatmap.js";
import { leakTrend, leakWeeks, type Leaks } from "./leaks.js";
import { overallRatingOf } from "./rating.js";
import { classMemory, leakHistoryRows, leakStatRows, ratedByTrack, storedRatings, trackRows } from "./repository.js";
import { effectiveTrackWeights, type TrackWeights } from "./weights.js";

type Rating = z.infer<typeof ratingSchema>;
type Tracks = z.infer<typeof tracksSchema>;
type Holdout = z.infer<typeof holdoutSchema>;
type HoldoutPageRound = Holdout["items"][number];

/** Who reads, when, and in which time zone (APP_TIME_ZONE, O-247). */
export interface ProgressCall {
  app: FastifyInstance;
  userId: string;
  now: Date;
  timeZone: string;
}

const trackCursorSchema = z.strictObject({ index: z.number().int().min(0).max(TRACK_KEYS.length) });
const roundCursorSchema = z.strictObject({ month: z.iso.date() });

async function catalogOf(call: ProgressCall, database: Database): Promise<ClassCatalog> {
  return loadClassCatalog(requireSolverQuery(call.app), database);
}

async function weightsOf(call: ProgressCall, database: Database): Promise<TrackWeights> {
  const catalog = await catalogOf(call, database);
  return effectiveTrackWeights(catalog.classes, await enabledTrackWeights(database));
}

/** GET /progress/rating. */
export async function ratingProgress(call: ProgressCall): Promise<Rating> {
  const database = requireDatabase(call.app);
  const stored = await storedRatings(database, call.userId, call.now);
  if (stored.ratings.size === 0) {
    return { overall: null, updated_at: null };
  }
  const overall = overallRatingOf(stored.ratings, await weightsOf(call, database));
  return { overall, updated_at: stored.updatedAt?.toISOString() ?? null };
}

/** GET /progress/tracks: the seven tracks in order, paged by position. */
export async function tracksProgress(call: ProgressCall, query: PageQuery): Promise<Tracks> {
  const database = requireDatabase(call.app);
  const start = query.cursor === undefined ? 0 : decodeCursor(query.cursor, trackCursorSchema).index;
  const [weights, stored, rated, tracks] = await Promise.all([
    weightsOf(call, database),
    storedRatings(database, call.userId, call.now),
    ratedByTrack(database, call.userId),
    trackRows(database),
  ]);
  const items = tracks.map((track, index) => {
    const rating = stored.ratings.get(track.key) ?? newTrackRating();
    const counts = rated.get(track.key);
    return {
      index,
      item: {
        track_key: track.key,
        name: trackDefinition(track.key).name,
        family: z.enum(["equilibrium", "exploit"]).parse(track.family),
        format: z.enum(["cash", "mtt"]).parse(track.format),
        weight: weights.get(track.key) ?? 0,
        mu: rating.rating,
        rd: rating.rd,
        conservative: conservativeRating(rating),
        rated_decisions: counts?.count ?? 0,
        last_rated_at: counts?.lastAt?.toISOString() ?? null,
      },
    };
  });
  const page = paginate(items.slice(start, start + query.limit + 1), query.limit, (entry) => ({ index: entry.index + 1 }));
  return { items: page.items.map((entry) => entry.item), next_cursor: page.next_cursor };
}

/** GET /progress/leaks?weeks. */
export async function leaksProgress(call: ProgressCall, weeks: number): Promise<Leaks> {
  const database = requireDatabase(call.app);
  const span = leakWeeks(localDay(call.now, call.timeZone), weeks);
  const catalog = await catalogOf(call, database);
  const [stats, history] = await Promise.all([
    leakStatRows(database, call.userId),
    leakHistoryRows(database, call.userId, span[0] ?? localDay(call.now, call.timeZone)),
  ]);
  return leakTrend(stats, history, span, (key) => {
    const cls = catalog.byKey.get(key);
    return cls === undefined ? undefined : { family: cls.family, trackKey: cls.trackKey };
  });
}

/** GET /progress/heatmap: one cell per catalog class. */
export async function heatmapProgress(call: ProgressCall): Promise<Heatmap> {
  const database = requireDatabase(call.app);
  const catalog = await catalogOf(call, database);
  const memory = await classMemory(database, call.userId, call.now);
  const classes = catalog.classes.flatMap((cls) => {
    const pair = cls.options[0]?.pair;
    return pair === undefined ? [] : [{ spotClassKey: cls.spotClassKey, family: cls.family, pair, depthBand: cls.depthBand, format: cls.format }];
  });
  return heatmapOf(classes, (key) => memory.get(key));
}

async function liveTracks(database: Database, round: HoldoutRound): Promise<HoldoutPageRound["tracks"]> {
  const [totals, scores] = await Promise.all([itemTotals(database), roundScores(database, round.id)]);
  return [...totals].map(([key, { total }]) => {
    const score = scores.get(key);
    return { track_key: key, answered: score?.answered ?? 0, total, mean_score: score?.meanScore ?? null, mu: null, goodhart_flag: false };
  });
}

/** GET /progress/holdout: rounds newest first, and the open round's progress. */
export async function holdoutProgress(call: ProgressCall, query: PageQuery): Promise<Holdout> {
  const database = requireDatabase(call.app);
  const before = query.cursor === undefined ? null : decodeCursor(query.cursor, roundCursorSchema).month;
  const rounds = await roundsPage(database, call.userId, query.limit + 1, before);
  const page = paginate(rounds, query.limit, (round) => ({ month: round.month }));
  const summaries = await summariesOf(database, page.items.map((round) => round.id));
  const items = await Promise.all(
    page.items.map(async (round) => ({
      round_month: round.month,
      opened_at: round.openedAt.toISOString(),
      closed_at: round.closedAt?.toISOString() ?? null,
      tracks:
        round.closedAt === null
          ? await liveTracks(database, round)
          : (summaries.get(round.id) ?? []).map((summary) => ({
              track_key: summary.trackKey,
              answered: summary.answered,
              total: summary.total,
              mean_score: summary.meanScore,
              mu: summary.mu,
              goodhart_flag: summary.goodhartFlag,
            })),
    })),
  );
  return { items, next_cursor: page.next_cursor, open: await openProgress(database, call.userId) };
}

/** The open round's answered (scored) items and the item count, from the per-track counts (PR #27 review LOW 15). */
async function openProgress(database: Database, userId: string): Promise<Holdout["open"]> {
  const [latest] = await roundsPage(database, userId, 1, null);
  if (latest === undefined || latest.closedAt !== null) {
    return null;
  }
  const [scores, totals] = await Promise.all([roundScores(database, latest.id), itemTotals(database)]);
  const answered = [...scores.values()].reduce((sum, score) => sum + score.answered, 0);
  const total = [...totals.values()].reduce((sum, track) => sum + track.total, 0);
  return { round_month: latest.month, answered, total };
}

/** GET /progress/streak. */
export async function streakProgress(call: ProgressCall): Promise<StreakView> {
  return streakView(requireDatabase(call.app), call.userId, call.now, call.timeZone);
}
