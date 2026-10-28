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
 */
import { loadClassCatalog } from "../automated/class-catalog.js";
import { drawPort } from "../holdout/draw-port.js";
import { drawTrackItems, HOLDOUT_ITEMS_PER_TRACK } from "../holdout/draw.js";
import { drawnTrackIds, recordDraw } from "../holdout/repository.js";
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

/** One draw run (see the module doc); `newSeed` is node:crypto's 64 random bits unless a test fixes it. */
export async function runHoldoutDraw(context: Omit<JobContext, "timeZone">, newSeed: () => string = newSessionSeed): Promise<DrawReport> {
  const { transaction, services } = context;
  const solverQuery = services.solverQuery;
  if (solverQuery === null) {
    throw new Error("the holdout draw needs solver-query");
  }
  const catalog = await loadClassCatalog(solverQuery, transaction);
  const drawn = await drawnTrackIds(transaction);
  const tracks = await transaction.selectFrom("track").select(["id", "key"]).execute();
  const port = drawPort(solverQuery, `holdout-draw:${context.job.id}`, HOLDOUT_DRAW_DEADLINE_MS);
  const report: DrawReport = { recorded: [], short: [], uncovered: [] };
  for (const key of TRACK_KEYS) {
    const track = tracks.find((row) => row.key === key);
    if (track === undefined || drawn.has(track.id)) {
      continue;
    }
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
    await recordDraw(transaction, track.id, seed, items);
    report.recorded.push(key);
  }
  services.log.info({ job_id: context.job.id, ...report }, "holdout draw run");
  return report;
}

export const HOLDOUT_DRAW_JOB: JobDefinition = {
  kind: HOLDOUT_DRAW_KIND,
  nextPeriod: holdoutDrawPeriod,
  handler: async (context) => {
    await runHoldoutDraw(context);
  },
};
