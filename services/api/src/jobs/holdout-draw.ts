/**
 * The holdout draw job (R4.13, O-100 refined by O-276): daily, until every track's draw is recorded.
 *
 * Mechanism: for each seeded track without a holdout_draw row whose scope has covered classes in the
 * class catalog (every catalog configuration), a fresh seed of 64 random bits drives the draw
 * (holdout/draw.ts). A draw of HOLDOUT_ITEMS_PER_TRACK items is recorded with its seed and items in
 * the job's transaction; a shorter one is discarded and the track is tried again the next day with a
 * new seed. A recorded track is never drawn again. A track with no covered class waits (on the
 * fixture library, likely the live limped and straddled track). Without solver-query the handler
 * throws, so the job is retried after its backoff.
 *
 * Once every track is drawn (PR #27 review MEDIUM 9) a run returns before it loads the class catalog
 * or touches solver-query, and the schedule's isComplete stops ensureScheduled from queueing more
 * runs, so a finished draw costs one cheap read per worker tick and nothing else.
 */
import { loadClassCatalog } from "../automated/class-catalog.js";
import { drawPort } from "../holdout/draw-port.js";
import { drawTrackItems, HOLDOUT_ITEMS_PER_TRACK } from "../holdout/draw.js";
import { drawnTrackIds, recordDraw } from "../holdout/repository.js";
import type { Database } from "../db.js";
import { TRACK_KEYS } from "../learning/tracks.js";
import { newSessionSeed } from "../sessions/randomness.js";
import { localDay, startOfDay } from "../streaks/calendar.js";
import type { JobContext, JobDefinition } from "./registry.js";
import type { JobPeriod } from "./schedule.js";

/** registry.ts JOB_KINDS.holdoutDraw; spelled here because registry.ts imports this module. */
export const HOLDOUT_DRAW_KIND = "holdout_draw";
/** solver-query time one run may spend drawing: well inside the job lease (JOB_LEASE_MS). */
export const HOLDOUT_DRAW_DEADLINE_MS = 5 * 60 * 1000;

/** The local day current at `now`: one draw run per day. */
export function holdoutDrawPeriod(now: Date, timeZone: string): JobPeriod {
  const day = localDay(now, timeZone);
  return { periodKey: day, runAt: startOfDay(day, timeZone) };
}

export interface DrawReport {
  recorded: string[];
  short: string[];
  uncovered: string[];
}

/** The seeded tracks without a recorded draw, in TRACK_KEYS order. */
async function undrawnTracks(database: Database): Promise<{ id: string; key: (typeof TRACK_KEYS)[number] }[]> {
  const drawn = await drawnTrackIds(database);
  const tracks = await database.selectFrom("track").select(["id", "key"]).execute();
  return TRACK_KEYS.flatMap((key) => {
    const track = tracks.find((row) => row.key === key);
    return track === undefined || drawn.has(track.id) ? [] : [{ id: track.id, key }];
  });
}

/** True once every seeded track has its draw (MEDIUM 9: the job is then no longer scheduled). */
export async function everyTrackDrawn(database: Database): Promise<boolean> {
  return (await undrawnTracks(database)).length === 0;
}

/** One draw run (see the module doc); `newSeed` is node:crypto's 64 random bits unless a test fixes it. */
export async function runHoldoutDraw(context: Omit<JobContext, "timeZone">, newSeed: () => string = newSessionSeed): Promise<DrawReport> {
  const { transaction, services } = context;
  const report: DrawReport = { recorded: [], short: [], uncovered: [] };
  const pending = await undrawnTracks(transaction);
  if (pending.length === 0) {
    services.log.info({ job_id: context.job.id }, "holdout draw complete; nothing to draw");
    return report;
  }
  const solverQuery = services.solverQuery;
  if (solverQuery === null) {
    throw new Error("the holdout draw needs solver-query");
  }
  const catalog = await loadClassCatalog(solverQuery, transaction);
  const port = drawPort(solverQuery, `holdout-draw:${context.job.id}`, HOLDOUT_DRAW_DEADLINE_MS);
  for (const { id: trackId, key } of pending) {
    const classes = catalog.classes.filter((cls) => cls.trackKey === key);
    if (classes.length === 0) {
      report.uncovered.push(key);
      continue;
    }
    const seed = newSeed();
    const items = await drawTrackItems(classes, key, seed, port);
    if (items.length < HOLDOUT_ITEMS_PER_TRACK) {
      report.short.push(key);
      continue;
    }
    await recordDraw(transaction, trackId, seed, items);
    report.recorded.push(key);
  }
  services.log.info({ job_id: context.job.id, ...report }, "holdout draw run");
  return report;
}

export const HOLDOUT_DRAW_JOB: JobDefinition = {
  kind: HOLDOUT_DRAW_KIND,
  nextPeriod: holdoutDrawPeriod,
  isComplete: everyTrackDrawn,
  handler: async (context) => {
    await runHoldoutDraw(context);
  },
};
