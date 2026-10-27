/**
 * The idempotency_key table operations behind the Idempotency-Key hooks (R3.1, A5 section 3,
 * O-232; table from migration 20261027000100_api_auth_idempotency).
 *
 * Mechanism: claimKey inserts (user_id, key, method, route, request_hash) with status_code null
 * and on conflict does nothing; a returned row means this request owns the key and its handler may
 * run. Otherwise it reads the existing row and decides: a row older than IDEMPOTENCY_RETENTION_HOURS
 * is claimed again with one conditional update (only while it is still that old, so two retries
 * cannot both win); a different request_hash is a mismatch; a null status_code is still in flight;
 * anything else is replayed. If the row vanished between the insert and the read (its request
 * failed and released it), the claim is tried again, a bounded number of times. The age test runs
 * in SQL against now(), so the api's clock never matters.
 *
 * completeKey stores the first response; releaseKey deletes a claim that has not completed, so a
 * failed request leaves the key free for its retry. Both touch only an in-flight row, so they can
 * never overwrite or delete a stored response. The body is written as JSON text and cast to jsonb
 * in SQL (pg would send a JavaScript array as a Postgres array); jsonb keeps the value, not the key
 * order, so a replay is the same JSON value as the first response.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";

/** Keys older than this are treated as absent and may be reused (O-232). */
export const IDEMPOTENCY_RETENTION_HOURS = 24;

/** A claim lost to a concurrent release is retried at most this many times. */
const MAX_CLAIM_ATTEMPTS = 3;

export interface IdempotencyClaim {
  userId: string;
  key: string;
}

export interface IdempotencyCandidate extends IdempotencyClaim {
  method: string;
  route: string;
  requestHash: Buffer;
}

export type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "mismatch" }
  | { kind: "in-flight" }
  | { kind: "replay"; statusCode: number; body: unknown };

interface ExistingRow {
  request_hash: Buffer;
  status_code: number | null;
  response_body: unknown;
  expired: boolean;
}

const retentionCutoff = sql<Date>`now() - make_interval(hours => ${IDEMPOTENCY_RETENTION_HOURS})`;

async function tryInsert(database: Database, candidate: IdempotencyCandidate): Promise<boolean> {
  const inserted = await database
    .insertInto("idempotency_key")
    .values({
      user_id: candidate.userId,
      key: candidate.key,
      method: candidate.method,
      route: candidate.route,
      request_hash: candidate.requestHash,
    })
    .onConflict((conflict) => conflict.columns(["user_id", "key"]).doNothing())
    .returning("user_id")
    .executeTakeFirst();
  return inserted !== undefined;
}

async function tryReclaimExpired(database: Database, candidate: IdempotencyCandidate): Promise<boolean> {
  const reclaimed = await database
    .updateTable("idempotency_key")
    .set({
      method: candidate.method,
      route: candidate.route,
      request_hash: candidate.requestHash,
      status_code: null,
      response_body: null,
      completed_at: null,
      created_at: sql<Date>`now()`,
    })
    .where("user_id", "=", candidate.userId)
    .where("key", "=", candidate.key)
    .where("created_at", "<", retentionCutoff)
    .returning("user_id")
    .executeTakeFirst();
  return reclaimed !== undefined;
}

async function findExisting(database: Database, claim: IdempotencyClaim): Promise<ExistingRow | undefined> {
  return database
    .selectFrom("idempotency_key")
    .select(["request_hash", "status_code", "response_body"])
    .select(sql<boolean>`created_at < ${retentionCutoff}`.as("expired"))
    .where("user_id", "=", claim.userId)
    .where("key", "=", claim.key)
    .executeTakeFirst();
}

function outcomeOf(existing: ExistingRow, requestHash: Buffer): ClaimOutcome {
  if (!existing.request_hash.equals(requestHash)) {
    return { kind: "mismatch" };
  }
  if (existing.status_code === null) {
    return { kind: "in-flight" };
  }
  return { kind: "replay", statusCode: existing.status_code, body: existing.response_body };
}

/** Claims the key for this request, or says why the handler must not run. */
export async function claimKey(database: Database, candidate: IdempotencyCandidate): Promise<ClaimOutcome> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    if (await tryInsert(database, candidate)) {
      return { kind: "claimed" };
    }
    const existing = await findExisting(database, candidate);
    if (existing === undefined) {
      continue;
    }
    if (!existing.expired) {
      return outcomeOf(existing, candidate.requestHash);
    }
    if (await tryReclaimExpired(database, candidate)) {
      return { kind: "claimed" };
    }
  }
  return { kind: "in-flight" };
}

/** Stores the first response of a claimed key; bodyJson is JSON text or null for no body. */
export async function completeKey(
  database: Database,
  claim: IdempotencyClaim,
  statusCode: number,
  bodyJson: string | null,
): Promise<void> {
  await database
    .updateTable("idempotency_key")
    .set({
      status_code: statusCode,
      response_body: bodyJson === null ? null : sql`cast(${bodyJson} as jsonb)`,
      completed_at: sql<Date>`now()`,
    })
    .where("user_id", "=", claim.userId)
    .where("key", "=", claim.key)
    .where("status_code", "is", null)
    .execute();
}

/** Frees a claim whose request did not complete, so a retry runs the handler. */
export async function releaseKey(database: Database, claim: IdempotencyClaim): Promise<void> {
  await database
    .deleteFrom("idempotency_key")
    .where("user_id", "=", claim.userId)
    .where("key", "=", claim.key)
    .where("status_code", "is", null)
    .execute();
}
