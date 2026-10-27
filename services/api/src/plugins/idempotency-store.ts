/**
 * The idempotency_key table operations behind the Idempotency-Key hooks (R3.1, A5 section 3,
 * O-232; table from migration 20261027000100_api_auth_idempotency).
 *
 * Mechanism: claimKey first purges the user's rows older than IDEMPOTENCY_RETENTION_HOURS (the
 * created_at index serves it), then inserts (user_id, key, method, route, request_hash) with a
 * fresh claim_token and status_code null, doing nothing on conflict; a returned row means this
 * request owns the key and its handler may run. Otherwise it reads the existing row and decides:
 * a different request_hash is a mismatch; a stored status is a replay; a null status is in flight,
 * unless the claim is older than IDEMPOTENCY_LEASE_SECONDS, in which case its request is presumed
 * dead (a crash, an out-of-memory kill, a release that failed) and one conditional update takes
 * the claim over with a new claim_token, so two retries cannot both win. If the row vanished
 * between the insert and the read (its request failed and released it), the claim is tried again,
 * a bounded number of times. Every age test runs in SQL against now(), so the api's clock never
 * matters.
 *
 * completeKey stores the first response and releaseKey deletes a claim; both match the claim_token
 * and a null status_code, so they never touch a stored response or a claim another request took
 * over. completeKey reports whether it stored anything: a handler that writes through
 * http/idempotent-write.ts calls it inside its own transaction and rolls back when the claim was
 * lost. The body is written as JSON text cast to jsonb in SQL; jsonb keeps the value, not the key
 * order, so a replay is the same JSON value as the first response.
 */
import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { Database } from "../db.js";

/** Keys older than this are purged and may be reused (O-232). */
export const IDEMPOTENCY_RETENTION_HOURS = 24;
/** An in-flight claim older than this is presumed dead and may be taken over (O-232). */
export const IDEMPOTENCY_LEASE_SECONDS = 60;

/** A claim lost to a concurrent release is retried at most this many times. */
const MAX_CLAIM_ATTEMPTS = 3;

export interface IdempotencyClaim {
  userId: string;
  key: string;
  /** Which request owns the claim. */
  token: string;
}

export interface IdempotencyCandidate {
  userId: string;
  key: string;
  method: string;
  route: string;
  requestHash: Buffer;
}

export type ClaimOutcome =
  | { kind: "claimed"; claim: IdempotencyClaim }
  | { kind: "mismatch" }
  | { kind: "in-flight" }
  | { kind: "replay"; statusCode: number; body: unknown };

interface ExistingRow {
  request_hash: Buffer;
  status_code: number | null;
  response_body: unknown;
  lease_expired: boolean;
}

const retentionCutoff = sql<Date>`now() - make_interval(hours => ${IDEMPOTENCY_RETENTION_HOURS})`;
const leaseCutoff = sql<Date>`now() - make_interval(secs => ${IDEMPOTENCY_LEASE_SECONDS})`;

async function purgeExpired(database: Database, userId: string): Promise<void> {
  await database.deleteFrom("idempotency_key").where("user_id", "=", userId).where("created_at", "<", retentionCutoff).execute();
}

async function tryInsert(database: Database, candidate: IdempotencyCandidate, token: string): Promise<boolean> {
  const inserted = await database
    .insertInto("idempotency_key")
    .values({
      user_id: candidate.userId,
      key: candidate.key,
      method: candidate.method,
      route: candidate.route,
      request_hash: candidate.requestHash,
      claim_token: token,
    })
    .onConflict((conflict) => conflict.columns(["user_id", "key"]).doNothing())
    .returning("user_id")
    .executeTakeFirst();
  return inserted !== undefined;
}

/** Takes over an in-flight claim whose lease ran out; false when another request got there first. */
async function tryTakeOver(database: Database, candidate: IdempotencyCandidate, token: string): Promise<boolean> {
  const taken = await database
    .updateTable("idempotency_key")
    .set({ claim_token: token, created_at: sql<Date>`now()` })
    .where("user_id", "=", candidate.userId)
    .where("key", "=", candidate.key)
    .where("request_hash", "=", candidate.requestHash)
    .where("status_code", "is", null)
    .where("created_at", "<", leaseCutoff)
    .returning("user_id")
    .executeTakeFirst();
  return taken !== undefined;
}

async function findExisting(database: Database, candidate: IdempotencyCandidate): Promise<ExistingRow | undefined> {
  return database
    .selectFrom("idempotency_key")
    .select(["request_hash", "status_code", "response_body"])
    .select(sql<boolean>`created_at < ${leaseCutoff}`.as("lease_expired"))
    .where("user_id", "=", candidate.userId)
    .where("key", "=", candidate.key)
    .executeTakeFirst();
}

/** Claims the key for this request, or says why the handler must not run. */
export async function claimKey(database: Database, candidate: IdempotencyCandidate): Promise<ClaimOutcome> {
  await purgeExpired(database, candidate.userId);
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const token = randomUUID();
    const claim: IdempotencyClaim = { userId: candidate.userId, key: candidate.key, token };
    if (await tryInsert(database, candidate, token)) {
      return { kind: "claimed", claim };
    }
    const existing = await findExisting(database, candidate);
    if (existing === undefined) {
      continue;
    }
    if (!existing.request_hash.equals(candidate.requestHash)) {
      return { kind: "mismatch" };
    }
    if (existing.status_code !== null) {
      return { kind: "replay", statusCode: existing.status_code, body: existing.response_body };
    }
    if (existing.lease_expired && (await tryTakeOver(database, candidate, token))) {
      return { kind: "claimed", claim };
    }
    return { kind: "in-flight" };
  }
  return { kind: "in-flight" };
}

/**
 * Stores the first response of a claim the request still owns; bodyJson is JSON text or null for
 * no body. Returns false when nothing was stored (the claim was taken over or already settled).
 */
export async function completeKey(
  database: Database,
  claim: IdempotencyClaim,
  statusCode: number,
  bodyJson: string | null,
): Promise<boolean> {
  const result = await database
    .updateTable("idempotency_key")
    .set({
      status_code: statusCode,
      response_body: bodyJson === null ? null : sql`cast(${bodyJson} as jsonb)`,
      completed_at: sql<Date>`now()`,
    })
    .where("user_id", "=", claim.userId)
    .where("key", "=", claim.key)
    .where("claim_token", "=", claim.token)
    .where("status_code", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

/** Frees a claim the request still owns and has not completed, so a retry runs the handler. */
export async function releaseKey(database: Database, claim: IdempotencyClaim): Promise<void> {
  await database
    .deleteFrom("idempotency_key")
    .where("user_id", "=", claim.userId)
    .where("key", "=", claim.key)
    .where("claim_token", "=", claim.token)
    .where("status_code", "is", null)
    .execute();
}
