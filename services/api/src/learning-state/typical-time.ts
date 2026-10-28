/**
 * The typical response time a review's Easy grade is measured against (R4.11, O-273): the median
 * response time of the user's last TYPICAL_RESPONSE_SAMPLE earlier non-worked-example attempts in
 * the class, or TYPICAL_RESPONSE_MS_DEFAULT with fewer than TYPICAL_RESPONSE_MIN_SAMPLES.
 *
 * Mechanism: a worked example shows every panel, so it is an attempt with panels_revealed true, and
 * so is any drill decision made with the answer on screen; neither says how fast the user recalls
 * the class, so only panels-hidden attempts are sampled. "Earlier" means before the block under
 * review: the block's own attempts are the class's most recent panels-hidden attempts of the user
 * (a block serves its class in consecutive decisions), so the newest `blockSize` are skipped.
 * Attempts order by created_at, then by id (uuidv7, time ordered) on equal times.
 */
import type { Database } from "../db.js";

/** O-273: how many earlier attempts the median takes. */
export const TYPICAL_RESPONSE_SAMPLE = 20;
/** O-273: below this many earlier attempts the default applies. */
export const TYPICAL_RESPONSE_MIN_SAMPLES = 5;
/** O-273: the typical response time with too little history, in milliseconds. */
export const TYPICAL_RESPONSE_MS_DEFAULT = 8000;

const HALF = 2;

/** The median of a non-empty list (the mean of the middle two for an even count). */
export function medianMs(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError("medianMs needs at least one value");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / HALF);
  const upper = sorted[middle] ?? Number.NaN;
  return sorted.length % HALF === 0 ? ((sorted[middle - 1] ?? Number.NaN) + upper) / HALF : upper;
}

/** O-273's rule over the earlier response times, newest first. */
export function typicalResponseFrom(earlierMs: readonly number[]): number {
  return earlierMs.length < TYPICAL_RESPONSE_MIN_SAMPLES
    ? TYPICAL_RESPONSE_MS_DEFAULT
    : medianMs(earlierMs.slice(0, TYPICAL_RESPONSE_SAMPLE));
}

export interface TypicalTimeRequest {
  userId: string;
  spotClassKey: string;
  /** The block's own attempts, already stored, which are skipped. */
  blockSize: number;
}

/** The user's typical response time in the class before the block under review (O-273). */
export async function typicalResponseMs(database: Database, request: TypicalTimeRequest): Promise<number> {
  const rows = await database
    .selectFrom("attempt")
    .select("response_ms")
    .where("user_id", "=", request.userId)
    .where("spot_class_key", "=", request.spotClassKey)
    .where("panels_revealed", "=", false)
    .where("response_ms", "is not", null)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .offset(request.blockSize)
    .limit(TYPICAL_RESPONSE_SAMPLE)
    .execute();
  // An attempt without a stored response time says nothing about speed.
  return typicalResponseFrom(rows.flatMap((row) => (row.response_ms === null ? [] : [row.response_ms])));
}
