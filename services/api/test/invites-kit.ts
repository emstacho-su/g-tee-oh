/**
 * Shared fixtures of the invite tests (S42, R3.1, R3.5): an admin made through the owner
 * connection (the app role cannot set is_admin, O-242), invite rows written straight into the
 * table with a known secret (so expiry and state can be set without waiting), and the requests a
 * browser sends to the five invite routes. Every public request comes from its own client address
 * unless a test passes one, so the per-IP limits never apply across tests.
 */
import { inject } from "vitest";
import type pg from "pg";

import type { ApiApp } from "../src/app.js";
import { formatInviteToken, newInviteSecret } from "../src/auth/invite-token.js";
import { createUser } from "../src/auth/users.js";
import { createDatabaseFromUrl, type Database } from "../src/db.js";
import { SESSION_COOKIE_NAME } from "../src/http/openapi.js";
import { APP_ORIGIN, mutatingHeaders, readHeaders } from "./support/app.js";
import { createTestSession, TEST_PASSWORD, uniqueEmail, type TestSession } from "./support/database.js";

export const INVITES_URL = "/api/v1/admin/invites";
export const INSPECT_URL = "/api/v1/auth/invites/inspect";
export const JOIN_URL = "/api/v1/auth/join";
export const ME_URL = "/api/v1/me";
export const INVITE_INVALID_TYPE = "urn:g-tee-oh:problem:invite-invalid";
export const NEW_PASSWORD = "a long enough join passphrase";
export const DAY_MS = 24 * 60 * 60 * 1000;

export function revokeUrl(id: string): string {
  return `${INVITES_URL}/${id}/revoke`;
}

let clientCounter = 0;
/** A distinct client address per request. */
export function nextClientAddress(): string {
  clientCounter += 1;
  return `10.42.${Math.floor(clientCounter / 250)}.${(clientCounter % 250) + 1}`;
}

export interface TestAdmin {
  id: string;
  email: string;
  session: TestSession;
}

/** An admin account and a live session, created as create-user --admin does. */
export async function createTestAdmin(database: Database, prefix = "invite-admin"): Promise<TestAdmin> {
  const ownerDatabase = createDatabaseFromUrl(inject("adminDatabaseUrl"));
  try {
    const email = uniqueEmail(prefix);
    const { id } = await createUser(ownerDatabase, { email, password: TEST_PASSWORD, isAdmin: true });
    return { id, email, session: await createTestSession(database, id) };
  } finally {
    await ownerDatabase.destroy();
  }
}

export interface InviteRowOptions {
  email?: string;
  createdBy: string;
  createdAt?: Date;
  expiresAt?: Date;
  usedBy?: string;
  revokedAt?: Date;
}

export interface SeededInvite {
  id: string;
  email: string;
  token: string;
  secret: string;
}

/** Writes an invite row directly through the superuser pool and returns its working token. */
export async function insertInvite(pool: pg.Pool, options: InviteRowOptions): Promise<SeededInvite> {
  const email = options.email ?? uniqueEmail("invitee");
  const { secret, hash } = newInviteSecret();
  const createdAt = options.createdAt ?? new Date();
  const expiresAt = options.expiresAt ?? new Date(createdAt.getTime() + 7 * DAY_MS);
  const usedAt = options.usedBy === undefined ? null : new Date();
  const result = await pool.query<{ id: string }>(
    `insert into invite (email, secret_hash, created_by, created_at, expires_at, used_at, used_by, revoked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [email, hash, options.createdBy, createdAt, expiresAt, usedAt, options.usedBy ?? null, options.revokedAt ?? null],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("the invite insert returned no id");
  return { id, email, token: formatInviteToken(id, secret), secret };
}

export function createInvite(app: ApiApp, admin: TestAdmin, email: string, remoteAddress = nextClientAddress()) {
  return app.inject({
    method: "POST",
    url: INVITES_URL,
    headers: mutatingHeaders(admin.session),
    remoteAddress,
    payload: { email },
  });
}

export function listInvites(app: ApiApp, session: Pick<TestSession, "token">, query = "") {
  return app.inject({ method: "GET", url: `${INVITES_URL}${query}`, headers: readHeaders(session) });
}

export function inspectInvite(app: ApiApp, token: string, remoteAddress = nextClientAddress()) {
  return app.inject({ method: "POST", url: INSPECT_URL, headers: { origin: APP_ORIGIN }, remoteAddress, payload: { token } });
}

export interface JoinOptions {
  displayName?: string;
  password?: string;
  remoteAddress?: string;
  cookie?: string;
}

export function joinWith(app: ApiApp, token: string, options: JoinOptions = {}) {
  const headers: Record<string, string> = { origin: APP_ORIGIN };
  if (options.cookie !== undefined) headers.cookie = `${SESSION_COOKIE_NAME}=${options.cookie}`;
  return app.inject({
    method: "POST",
    url: JOIN_URL,
    headers,
    remoteAddress: options.remoteAddress ?? nextClientAddress(),
    payload: {
      token,
      display_name: options.displayName ?? "New Member",
      password: options.password ?? NEW_PASSWORD,
    },
  });
}

/** The token half of a link the create route answered. */
export function tokenOfLink(link: string): string {
  const hash = link.indexOf("#");
  if (hash < 0) throw new Error("the link has no fragment");
  return link.slice(hash + 1);
}
