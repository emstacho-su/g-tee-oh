/**
 * Application users (R3.1, A9 section 3, O-233, O-349): creating an account and looking one up by
 * email for login. There is no public sign-up (O-349 narrows O-233): an account is made by the
 * create-user command (cli/create-user.ts) for the owner, or by POST /auth/join from an invite an
 * admin made (routes/join.ts), and by the tests.
 *
 * Mechanism: emails are normalized (trimmed, lowercased) before they are validated, stored or looked
 * up, so app_user.email holds one spelling per address and login matches it whatever case the user
 * types; the column's unique constraint then also rejects a duplicate that differs only in case.
 * The email must pass the same check login applies (schemas/auth.ts), and the password must meet
 * the new-account rule (account-rules.ts), so every account created can log in. The password is
 * hashed with argon2id (password.ts) and never leaves this module in any form but the hash.
 * createUserWithHash takes a hash made earlier, so join can hash before it opens its transaction
 * and holds no lock while argon2 runs (S42 review round 1, C); the caller has already checked the
 * password with newPasswordFailure. A duplicate is detected from Postgres' unique-violation code
 * rather than by a lookup first, so two concurrent calls cannot both succeed. isAdmin sets
 * app_user.is_admin, which the admin endpoints require (O-242); it defaults to false. The app role
 * holds insert on email, password_hash and display_name only (PR #25 review L1, S42), so a plain
 * account's insert leaves is_admin to its default and an admin can be created only through a
 * connection as the database owner (cli/create-user-run.ts); on the app connection isAdmin fails
 * with Postgres' insufficient-privilege error.
 */
import { z } from "zod";

import type { Database } from "../db.js";
import { PG_ERROR, pgErrorCode } from "../http/problem.js";
import { MAX_EMAIL_LENGTH } from "../schemas/auth.js";
import { MIN_NEW_PASSWORD_LENGTH, newPasswordFailure, PASSWORD_FAILURE_TEXT } from "./account-rules.js";
import { hashPassword } from "./password.js";

export { MIN_NEW_PASSWORD_LENGTH };

const emailSchema = z.email().max(MAX_EMAIL_LENGTH);

export type CreateUserFailure = "invalid-email" | "password-too-short" | "password-too-long" | "duplicate-email";

/** An expected failure of createUser; the message is safe to show and never holds the password. */
export class CreateUserError extends Error {
  readonly reason: CreateUserFailure;

  constructor(reason: CreateUserFailure, message: string) {
    super(message);
    this.name = "CreateUserError";
    this.reason = reason;
  }
}

interface AccountFields {
  email: string;
  /** May use the admin endpoints (O-242); false when absent. */
  isAdmin?: boolean;
  /**
   * The member's name (S42, O-426), already validated by the join schema (schemas/invites.ts);
   * absent for an account made by create-user, which stores null.
   */
  displayName?: string;
}

export interface NewUserInput extends AccountFields {
  password: string;
}

export interface HashedUserInput extends AccountFields {
  /** An argon2id hash from hashPassword, of a password that passed newPasswordFailure. */
  passwordHash: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: Date;
}

export interface UserCredentials {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  createdAt: Date;
  /** app_user.is_admin, returned by login as user.is_admin (O-290). */
  isAdmin: boolean;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function validEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (!emailSchema.safeParse(email).success) {
    throw new CreateUserError("invalid-email", "The email address is not valid.");
  }
  return email;
}

/** Throws CreateUserError when the password does not meet the new-account rule. */
export function assertNewPassword(password: string): void {
  const failure = newPasswordFailure(password);
  if (failure !== null) throw new CreateUserError(failure, PASSWORD_FAILURE_TEXT[failure]);
}

/** Creates an account; throws CreateUserError for bad input or an email already in use. */
export async function createUser(database: Database, input: NewUserInput): Promise<CreatedUser> {
  validEmail(input.email);
  assertNewPassword(input.password);
  const { password, ...account } = input;
  return createUserWithHash(database, { ...account, passwordHash: await hashPassword(password) });
}

/** Creates an account from a password hashed earlier; throws CreateUserError like createUser. */
export async function createUserWithHash(database: Database, input: HashedUserInput): Promise<CreatedUser> {
  const email = validEmail(input.email);
  try {
    // A plain account never names is_admin: the app role may insert email, password_hash and
    // display_name only, and the column defaults to false. Only the owner connection may set it.
    const account = { email, password_hash: input.passwordHash, display_name: input.displayName ?? null };
    const values = input.isAdmin === true ? { ...account, is_admin: true } : account;
    const row = await database
      .insertInto("app_user")
      .values(values)
      .returning(["id", "email", "display_name", "is_admin", "created_at"])
      .executeTakeFirstOrThrow();
    return { id: row.id, email: row.email, displayName: row.display_name, isAdmin: row.is_admin, createdAt: row.created_at };
  } catch (error: unknown) {
    if (pgErrorCode(error) === PG_ERROR.uniqueViolation) {
      throw new CreateUserError("duplicate-email", `A user with the email ${email} already exists.`);
    }
    throw error;
  }
}

/** The account login checks a password against, by normalized email; undefined when none. */
export async function findUserCredentials(database: Database, rawEmail: string): Promise<UserCredentials | undefined> {
  const row = await database
    .selectFrom("app_user")
    .select(["id", "email", "display_name", "password_hash", "created_at", "is_admin"])
    .where("email", "=", normalizeEmail(rawEmail))
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        isAdmin: row.is_admin,
      };
}
