// The e2e owner account (O-263, R3.13): the pure parts of the create-owner step that
// infra/compose/e2e.mjs runs between the database tests and the smoke, so a node:test file
// covers them without Docker (scripts/e2e-owner.test.mjs).
//
// Mechanism: every e2e run makes a fresh owner in the freshly migrated database with a random
// password, 24 random bytes from node:crypto encoded as base64url (32 characters, well over the
// 12 the api requires, O-233). The account is created by the bundled create-user command inside
// the running api container (`docker compose exec -T api node services/api/dist/create-user.js
// --email <email>`), which reads the password from its standard input. So the password is never
// an argument (the process list and the CI log would show it), never printed, and never written
// to .env or any file: it lives in this process's memory, goes to the command's stdin, and
// reaches Playwright only through the environment of the one e2e-web child process.

import { randomBytes } from 'node:crypto';

export const DEFAULT_OWNER_EMAIL = 'e2e-owner@example.com';
export const OWNER_EMAIL_VARIABLE = 'E2E_OWNER_EMAIL';
export const OWNER_PASSWORD_VARIABLE = 'E2E_OWNER_PASSWORD';
export const CREATE_USER_SCRIPT = 'services/api/dist/create-user.js';
export const API_SERVICE = 'api';
/** The api's own floor for a password (O-233); the generated one is far longer. */
export const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_BYTES = 24;
const PASSWORD_ENCODING = 'base64url';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const FLAG_PREFIX = '-';

/** Raised when the owner step cannot run with what it was given; the message says what to fix. */
export class OwnerSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OwnerSetupError';
  }
}

/**
 * A fresh password for one run. `random` is injectable so a test can pin the bytes; it must
 * return a Buffer of the requested length, as crypto.randomBytes does.
 */
export function generateOwnerPassword(random = randomBytes) {
  const password = random(PASSWORD_BYTES).toString(PASSWORD_ENCODING);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new OwnerSetupError(`the generated password is shorter than ${MIN_PASSWORD_LENGTH} characters`);
  }
  return password;
}

/**
 * The owner email, lowercased: E2E_OWNER_EMAIL when set and not blank, else e2e-owner@example.com. A value
 * that does not look like an address, or that starts with a dash and would read as a flag, is
 * refused here rather than by the command inside the container.
 */
export function ownerEmail(env) {
  const configured = env[OWNER_EMAIL_VARIABLE]?.trim();
  const email = configured === undefined || configured === '' ? DEFAULT_OWNER_EMAIL : configured;
  if (email.startsWith(FLAG_PREFIX) || !EMAIL_SHAPE.test(email)) {
    throw new OwnerSetupError(`${OWNER_EMAIL_VARIABLE} is not an email address`);
  }
  // The api stores emails trimmed and lowercased (services/api/src/auth/users.ts normalizeEmail),
  // so the address the Playwright flow expects in the header is the lowercased one.
  return email.toLowerCase();
}

/** The docker arguments for the create-owner step: the email only, never the password. */
export function createOwnerArgs(composeArgs, email) {
  return [...composeArgs, 'exec', '-T', API_SERVICE, 'node', CREATE_USER_SCRIPT, '--email', email];
}

/** What the create-user command reads from stdin: the password as its first line. */
export function createOwnerInput(password) {
  return `${password}\n`;
}

/** A new environment for the e2e-web child: the parent's plus the two owner variables. */
export function e2eWebEnv(baseEnv, owner) {
  return {
    ...baseEnv,
    [OWNER_EMAIL_VARIABLE]: owner.email,
    [OWNER_PASSWORD_VARIABLE]: owner.password,
  };
}
