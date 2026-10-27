/**
 * Application users (R3.1, A9 section 3, O-233): creating an account and looking one up by email
 * for login. A5 has no sign-up route, so createUser is reached only through the create-user command
 * (cli/create-user.ts) and the tests.
 *
 * Mechanism: emails are normalized (trimmed, lowercased) before they are validated, stored or looked
 * up, so app_user.email holds one spelling per address and login matches it whatever case the user
 * types; the column's unique constraint then also rejects a duplicate that differs only in case.
 * The email must pass the same check login applies (schemas/auth.ts), and the password must fit
 * between MIN_NEW_PASSWORD_LENGTH and the login maximum, so every account created can log in. The
 * minimum applies to new accounts only; login accepts any stored password. The password is hashed
 * with argon2id (password.ts) and never leaves this module in any form but the hash. A duplicate is
 * detected from Postgres' unique-violation code rather than by a lookup first, so two concurrent
 * calls cannot both succeed.
 */
import { z } from "zod";

import type { Database } from "../db.js";
import { PG_ERROR, pgErrorCode } from "../http/problem.js";
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from "../schemas/auth.js";
import { hashPassword } from "./password.js";

/** The minimum password length for a new account, in characters (A9 section 3). */
export const MIN_NEW_PASSWORD_LENGTH = 12;

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

export interface NewUserInput {
  email: string;
  password: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  createdAt: Date;
}

export interface UserCredentials {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function characterCount(text: string): number {
  return Array.from(text).length;
}

function validateNewUser(input: NewUserInput): string {
  const email = normalizeEmail(input.email);
  if (!emailSchema.safeParse(email).success) {
    throw new CreateUserError("invalid-email", "The email address is not valid.");
  }
  const length = characterCount(input.password);
  if (length < MIN_NEW_PASSWORD_LENGTH) {
    throw new CreateUserError(
      "password-too-short",
      `The password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters long.`,
    );
  }
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    throw new CreateUserError("password-too-long", `The password must be at most ${MAX_PASSWORD_LENGTH} characters long.`);
  }
  return email;
}

/** Creates an account; throws CreateUserError for bad input or an email already in use. */
export async function createUser(database: Database, input: NewUserInput): Promise<CreatedUser> {
  const email = validateNewUser(input);
  const passwordHash = await hashPassword(input.password);
  try {
    const row = await database
      .insertInto("app_user")
      .values({ email, password_hash: passwordHash })
      .returning(["id", "email", "created_at"])
      .executeTakeFirstOrThrow();
    return { id: row.id, email: row.email, createdAt: row.created_at };
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
    .select(["id", "email", "password_hash", "created_at"])
    .where("email", "=", normalizeEmail(rawEmail))
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}
