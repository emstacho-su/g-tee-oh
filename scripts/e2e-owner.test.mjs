// R3.13, O-263: the pure parts of the e2e owner step (infra/compose/e2e-owner.mjs) and the
// step order of infra/compose/e2e.mjs, without Docker. node:test, run by `pnpm run test:scripts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CREATE_USER_SCRIPT,
  DEFAULT_OWNER_EMAIL,
  MIN_PASSWORD_LENGTH,
  OWNER_EMAIL_VARIABLE,
  OWNER_PASSWORD_VARIABLE,
  OwnerSetupError,
  createOwnerArgs,
  createOwnerInput,
  e2eWebEnv,
  generateOwnerPassword,
  ownerEmail,
} from '../infra/compose/e2e-owner.mjs';
import { COMPOSE_ARGS, OWNER_STEP, STEPS } from '../infra/compose/e2e.mjs';

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PASSWORD_BYTES = 24;
const BASE64URL_LENGTH_OF_24_BYTES = 32;
const PINNED_BYTE = 0xfb;

test('r3_13 generateOwnerPassword: 24 random bytes as base64url, at least 12 characters', () => {
  const password = generateOwnerPassword();
  assert.match(password, BASE64URL);
  assert.equal(password.length, BASE64URL_LENGTH_OF_24_BYTES);
  assert.ok(password.length >= MIN_PASSWORD_LENGTH);
});

test('r3_13 generateOwnerPassword asks for 24 bytes and differs per run', () => {
  const requested = [];
  const pinned = generateOwnerPassword((size) => {
    requested.push(size);
    return Buffer.alloc(size, PINNED_BYTE);
  });
  assert.deepEqual(requested, [PASSWORD_BYTES]);
  assert.equal(pinned, Buffer.alloc(PASSWORD_BYTES, PINNED_BYTE).toString('base64url'));
  assert.notEqual(generateOwnerPassword(), generateOwnerPassword());
});

test('r3_13 generateOwnerPassword refuses a source that yields too short a password', () => {
  assert.throws(() => generateOwnerPassword((size) => Buffer.alloc(Math.min(size, 3))), OwnerSetupError);
});

test('r3_13 ownerEmail defaults to e2e-owner@example.com and honors E2E_OWNER_EMAIL', () => {
  assert.equal(ownerEmail({}), DEFAULT_OWNER_EMAIL);
  assert.equal(ownerEmail({ [OWNER_EMAIL_VARIABLE]: '   ' }), DEFAULT_OWNER_EMAIL);
  assert.equal(ownerEmail({ [OWNER_EMAIL_VARIABLE]: ' me@example.org ' }), 'me@example.org');
});

test('r3_13 ownerEmail lowercases the address the way the api normalizes it', () => {
  assert.equal(ownerEmail({ [OWNER_EMAIL_VARIABLE]: ' Owner.E2E@Example.ORG ' }), 'owner.e2e@example.org');
});

test('r3_13 ownerEmail refuses a value that is not an address or reads as a flag', () => {
  for (const bad of ['not-an-email', '--email=x@example.com', 'a b@example.com']) {
    assert.throws(() => ownerEmail({ [OWNER_EMAIL_VARIABLE]: bad }), OwnerSetupError, bad);
  }
});

test('r3_13 createOwnerArgs runs create-user in the api container with the email only', () => {
  const args = createOwnerArgs(COMPOSE_ARGS, DEFAULT_OWNER_EMAIL);
  assert.deepEqual(args.slice(0, COMPOSE_ARGS.length), COMPOSE_ARGS);
  assert.deepEqual(args.slice(COMPOSE_ARGS.length), [
    'exec', '-T', 'api', 'node', CREATE_USER_SCRIPT, '--email', DEFAULT_OWNER_EMAIL,
  ]);
});

test('r3_13 the password never appears in the argument list, only on stdin', () => {
  const password = generateOwnerPassword();
  const args = createOwnerArgs(COMPOSE_ARGS, DEFAULT_OWNER_EMAIL);
  assert.ok(args.every((argument) => !argument.includes(password)));
  assert.equal(createOwnerInput(password), `${password}\n`);
});

test('r3_13 e2eWebEnv adds the owner to a new object and leaves the parent environment alone', () => {
  const parent = Object.freeze({ PATH: '/usr/bin', CI: 'true' });
  const owner = { email: DEFAULT_OWNER_EMAIL, password: 'pw-from-this-run-only' };
  const child = e2eWebEnv(parent, owner);
  assert.notEqual(child, parent);
  assert.deepEqual(child, {
    PATH: '/usr/bin',
    CI: 'true',
    [OWNER_EMAIL_VARIABLE]: owner.email,
    [OWNER_PASSWORD_VARIABLE]: owner.password,
  });
  assert.equal(OWNER_PASSWORD_VARIABLE in parent, false);
});

test('r3_13 the e2e chain creates the owner after the database steps and before smoke', () => {
  assert.deepEqual(STEPS, ['dev-up', 'db-migrate', 'db-test', OWNER_STEP, 'smoke', 'e2e-web']);
});
