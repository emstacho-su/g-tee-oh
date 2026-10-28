/**
 * Shared reads of the learning-state lane (R4.11, O-271, O-274, O-275): track ids by key, the
 * attempts that count toward leak stats, and the stored-label mapping back to learning's labels.
 *
 * Mechanism:
 * - Tracks are seeded rows (migration 20261029000200); attempt.track_ids holds their uuids, so the
 *   key (tracks.ts) and the id meet here. The seven rows never change after the migration, so the
 *   map is read once per process and cached, only once it holds every key (PR #27 review LOW 15):
 *   a decision then resolves its track without a query.
 * - Counted attempts (O-274, O-275): the user's attempts in drill and automated sessions with no
 *   answer-revealing panel on (panels_revealed false, which also leaves out worked examples), and
 *   never from a client-seeded session of any mode (PM seed condition, PR #27 review HIGH 2: the
 *   top-level state.seeded or the automated learning state's seeded; such a session writes no
 *   learning state, so a later recompute must not count it either). Holdout attempts never count.
 * - attempt.label stores the contract's lowercase label; learning reads its capitalized GradeLabel,
 *   mapped back through grading/feedback.ts CONTRACT_LABELS, the one place the two meet.
 */
import type { GradeLabel } from "@g-tee-oh/learning";
import { sql } from "kysely";

import type { Database } from "../db.js";
import { CONTRACT_LABELS } from "../grading/feedback.js";
import { TRACK_KEYS, type TrackKey } from "../learning/tracks.js";

/** The modes whose attempts feed leak stats (O-274): holdout and the S27 modes do not. */
export const LEAK_COUNTED_MODES = ["drill", "automated"] as const;

const GRADE_LABEL_BY_CONTRACT: ReadonlyMap<string, GradeLabel> = new Map(
  (Object.entries(CONTRACT_LABELS) as [GradeLabel, string][]).map(([grade, contract]) => [contract, grade]),
);

/** learning's GradeLabel for a stored (lowercase) or learning (capitalized) label; throws on any other text. */
export function gradeLabelOf(label: string): GradeLabel {
  const fromContract = GRADE_LABEL_BY_CONTRACT.get(label);
  if (fromContract !== undefined) {
    return fromContract;
  }
  const direct = (Object.keys(CONTRACT_LABELS) as GradeLabel[]).find((grade) => grade === label);
  if (direct === undefined) {
    throw new RangeError(`unknown grade label ${JSON.stringify(label)}`);
  }
  return direct;
}

/** The process's track map, set once it holds every track key (PR #27 review LOW 15). */
let cachedTrackIds: ReadonlyMap<TrackKey, string> | undefined;

/** Forgets the cached track map (tests that count queries). */
export function resetTrackIdCache(): void {
  cachedTrackIds = undefined;
}

/** Every seeded track's id by key, read once per process (see the module doc). */
export async function trackIdsByKey(database: Database): Promise<ReadonlyMap<TrackKey, string>> {
  if (cachedTrackIds !== undefined) {
    return cachedTrackIds;
  }
  const rows = await database.selectFrom("track").select(["id", "key"]).execute();
  const byKey: ReadonlyMap<TrackKey, string> = new Map(
    rows.flatMap((row) => {
      const key = TRACK_KEYS.find((candidate) => candidate === row.key);
      return key === undefined ? [] : [[key, row.id] as const];
    }),
  );
  // A partial map (a migration not yet applied) is answered but never cached.
  if (byKey.size === TRACK_KEYS.length) {
    cachedTrackIds = byKey;
  }
  return byKey;
}

/** The id of one seeded track; a missing seed row is a broken migration, so it throws. */
export async function trackIdOf(database: Database, key: TrackKey): Promise<string> {
  const id = (await trackIdsByKey(database)).get(key);
  if (id === undefined) {
    throw new Error(`the track table has no row for ${key}`);
  }
  return id;
}

/** The key of every seeded track by id. */
export async function trackKeysById(database: Database): Promise<ReadonlyMap<string, TrackKey>> {
  const byKey = await trackIdsByKey(database);
  return new Map([...byKey].map(([key, id]) => [id, key] as const));
}

/**
 * True for a practice_session row not created with a client-supplied seed, in any mode (PR #27
 * review HIGH 2): neither the top-level seeded flag nor the automated learning state's is set. A
 * filter for queries joined to practice_session.
 */
export const NOT_SEEDED_SESSION = sql<boolean>`not (coalesce((practice_session.state ->> 'seeded')::boolean, false)
  or coalesce((practice_session.state #>> '{learning,seeded}')::boolean, false))`;

/** The attempts of `userId` that count toward leak stats (see the module doc), joined to their session. */
export function countedAttempts(database: Database, userId: string) {
  return database
    .selectFrom("attempt")
    .innerJoin("practice_session", "practice_session.id", "attempt.session_id")
    .where("attempt.user_id", "=", userId)
    .where("attempt.panels_revealed", "=", false)
    .where("practice_session.mode", "in", [...LEAK_COUNTED_MODES])
    .where(NOT_SEEDED_SESSION);
}
