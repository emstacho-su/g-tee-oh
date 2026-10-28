/**
 * invite rows (S42, R3.1, R3.5, O-349, O-420, O-422, O-423): creating, listing, revoking, and
 * the check inspect and join share.
 *
 * Mechanism:
 * - Every write that decides something about an email's invites or account takes
 *   lockInviteEmail first: a transaction-scoped advisory lock keyed on the normalized email, the
 *   one key derivation for both create and join (review round 1, A). Create and join for the same
 *   email therefore run one after the other, so three simultaneous creates leave one working link,
 *   and a create racing a join either revokes the invite before the join uses it or sees the new
 *   account and refuses. The partial unique index invite_one_open_per_email_idx is the backstop.
 *   Lock order is always the email lock, then invite rows, so the two paths cannot deadlock.
 * - createInvite refuses an email that already has an account (409), revokes every open invite for
 *   that email, expired ones included (O-423), and inserts the new row with only the sha256 of a
 *   fresh secret, read back with RETURNING; the secret is returned once so the route can build the
 *   link, and is never stored.
 * - Status is computed on read (inviteStatus): used, else revoked, else expired when expires_at is
 *   at or before now, else pending. It is never stored, so it cannot go stale.
 * - usableInvite always runs exactly one constant-time digest comparison: against the row's
 *   secret_hash when the selector names a row, else against UNKNOWN_INVITE_DIGEST, so an unknown
 *   id and a wrong secret cost the same. The caller answers every unusable case with the same 410
 *   problem (O-422).
 * - The admin list selects only the summary's columns, never secret_hash (review round 1, K).
 * Every function takes a Kysely handle, so a caller may pass a transaction; rows are returned as
 * new objects and never mutated.
 */
import { sql } from "kysely";

import type { Database } from "../db.js";
import { HTTP_STATUS, PG_ERROR, pgErrorCode, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { InviteStatus, InviteSummary } from "../schemas/invites.js";
import { newInviteSecret, secretMatches, UNKNOWN_INVITE_DIGEST, type ParsedInviteToken } from "./invite-token.js";
import { normalizeEmail } from "./users.js";

/** How long an invite link works, from creation (O-420). */
export const INVITE_TTL_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One fixed text for every bad token (O-422). */
export const INVITE_INVALID_DETAIL = "This invite link is not valid. It may have expired or been used already.";
const ACCOUNT_EXISTS_DETAIL = "An account already exists for this email.";

/** What a summary shows; no secret. */
export interface InviteRecord {
  id: string;
  email: string;
  createdByEmail: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/** A record plus the digest inspect and join compare against. */
export interface InviteRow extends InviteRecord {
  secretHash: Buffer;
}

export interface NewInvite {
  summary: InviteSummary;
  /** The secret half of the link; shown once and never stored. */
  secret: string;
}

export interface InviteCreator {
  id: string;
  email: string;
}

export function inviteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITE_TTL_DAYS * MS_PER_DAY);
}

export function inviteStatus(row: Pick<InviteRecord, "usedAt" | "revokedAt" | "expiresAt">, now: Date): InviteStatus {
  if (row.usedAt !== null) return "used";
  if (row.revokedAt !== null) return "revoked";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export function toInviteSummary(row: InviteRecord, now: Date): InviteSummary {
  return {
    id: row.id,
    email: row.email,
    created_by_email: row.createdByEmail,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    used_at: row.usedAt?.toISOString() ?? null,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    status: inviteStatus(row, now),
  };
}

export function inviteInvalid(): ProblemError {
  return new ProblemError(HTTP_STATUS.gone, PROBLEM_SLUGS.inviteInvalid, { detail: INVITE_INVALID_DETAIL });
}

function accountExists(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.conflict, { detail: ACCOUNT_EXISTS_DETAIL });
}

/**
 * Serializes every invite decision about one email until the transaction ends: an advisory lock
 * keyed on hashtext of the normalized email (review round 1, A). Call it inside a transaction.
 */
export async function lockInviteEmail(transaction: Database, rawEmail: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${normalizeEmail(rawEmail)}))`.execute(transaction);
}

const RECORD_COLUMNS = [
  "invite.id",
  "invite.email",
  "invite.created_at",
  "invite.expires_at",
  "invite.used_at",
  "invite.revoked_at",
  "app_user.email as created_by_email",
] as const;

interface SelectedRecord {
  id: string;
  email: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  created_by_email: string;
}

function toRecord(selected: SelectedRecord): InviteRecord {
  return {
    id: selected.id,
    email: selected.email,
    createdByEmail: selected.created_by_email,
    createdAt: selected.created_at,
    expiresAt: selected.expires_at,
    usedAt: selected.used_at,
    revokedAt: selected.revoked_at,
  };
}

/** One invite with its digest, by id; for update locks the invite row for the rest of the transaction. */
export async function findInvite(database: Database, id: string, forUpdate = false): Promise<InviteRow | undefined> {
  const query = database
    .selectFrom("invite")
    .innerJoin("app_user", "app_user.id", "invite.created_by")
    .select([...RECORD_COLUMNS, "invite.secret_hash"])
    .where("invite.id", "=", id);
  const selected = await (forUpdate ? query.forUpdate("invite") : query).executeTakeFirst();
  return selected === undefined ? undefined : { ...toRecord(selected), secretHash: selected.secret_hash };
}

/**
 * The usable invite a parsed token names, or undefined. Exactly one constant-time comparison runs
 * whatever the outcome; a malformed token (null) compares against the dummy digest too.
 */
export function usableInvite(row: InviteRow | undefined, token: ParsedInviteToken | null, now: Date): InviteRow | undefined {
  const matches = secretMatches(row?.secretHash ?? UNKNOWN_INVITE_DIGEST, token?.secret ?? "");
  return row !== undefined && matches && inviteStatus(row, now) === "pending" ? row : undefined;
}

export async function emailHasAccount(database: Database, email: string): Promise<boolean> {
  const row = await database.selectFrom("app_user").select("id").where("email", "=", normalizeEmail(email)).executeTakeFirst();
  return row !== undefined;
}

/** Revokes every open invite for the email (expired ones included), except the one named. */
export async function revokeOpenInvites(database: Database, email: string, now: Date, exceptId?: string): Promise<void> {
  const base = database
    .updateTable("invite")
    .set({ revoked_at: now })
    .where("email", "=", normalizeEmail(email))
    .where("used_at", "is", null)
    .where("revoked_at", "is", null);
  await (exceptId === undefined ? base : base.where("id", "!=", exceptId)).execute();
}

/**
 * Creates an invite for the email under the email's lock. Run it in a transaction: the lock, the
 * account check, the revoke and the insert commit together.
 */
export async function createInvite(database: Database, rawEmail: string, creator: InviteCreator, now: Date): Promise<NewInvite> {
  const email = normalizeEmail(rawEmail);
  await lockInviteEmail(database, email);
  if (await emailHasAccount(database, email)) throw accountExists();
  await revokeOpenInvites(database, email, now);
  const { secret, hash } = newInviteSecret();
  try {
    const inserted = await database
      .insertInto("invite")
      .values({ email, secret_hash: hash, created_by: creator.id, created_at: now, expires_at: inviteExpiry(now) })
      .returning(["id", "email", "created_at", "expires_at", "used_at", "revoked_at"])
      .executeTakeFirstOrThrow();
    return { summary: toInviteSummary(toRecord({ ...inserted, created_by_email: creator.email }), now), secret };
  } catch (error: unknown) {
    // The partial unique index is the backstop; under the lock it should never fire.
    if (pgErrorCode(error) === PG_ERROR.uniqueViolation) {
      throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.conflict, { detail: "An open invite for this email already exists." });
    }
    throw error;
  }
}

/** A page of invites, newest first (uuidv7 ids are time-ordered), after the cursor's id if any. */
export async function listInvites(database: Database, limit: number, afterId: string | undefined): Promise<InviteRecord[]> {
  const base = database
    .selectFrom("invite")
    .innerJoin("app_user", "app_user.id", "invite.created_by")
    .select(RECORD_COLUMNS)
    .orderBy("invite.id", "desc")
    .limit(limit + 1);
  const rows = await (afterId === undefined ? base : base.where("invite.id", "<", afterId)).execute();
  return rows.map(toRecord);
}

/** Revokes a pending or expired invite; revoking twice answers the first revocation. */
export async function revokeInvite(database: Database, id: string, now: Date): Promise<InviteSummary> {
  const row = await findInvite(database, id, true);
  if (row === undefined) {
    throw new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No invite has this id." });
  }
  if (row.usedAt !== null) {
    throw new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.conflict, { detail: "This invite was already used." });
  }
  if (row.revokedAt !== null) return toInviteSummary(row, now);
  await database.updateTable("invite").set({ revoked_at: now }).where("id", "=", id).execute();
  return toInviteSummary({ ...row, revokedAt: now }, now);
}

/** Marks the invite used by the new account; called inside the join transaction. */
export async function markInviteUsed(database: Database, id: string, userId: string, now: Date): Promise<void> {
  await database.updateTable("invite").set({ used_at: now, used_by: userId }).where("id", "=", id).execute();
}
