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
  ADMIN_DATABASE_URL_VARIABLE,
  adminDatabaseUrl,
  createOwnerArgs,
  createOwnerEnv,
  createOwnerInput,
  e2eWebEnv,
  generateOwnerPassword,
  ownerEmail,
} from '../infra/compose/e2e-owner.mjs';
import { COMPOSE_ARGS, LEARNING_STEP, OWNER_STEP, STEPS, learningStepEnv, resolveOwner } from '../infra/compose/e2e.mjs';

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

test('r3_13 r3_5 createOwnerArgs runs create-user --admin in the api container, the admin URL passed by name only (O-294)', () => {
  const args = createOwnerArgs(COMPOSE_ARGS, DEFAULT_OWNER_EMAIL);
  assert.deepEqual(args.slice(0, COMPOSE_ARGS.length), COMPOSE_ARGS);
  assert.deepEqual(args.slice(COMPOSE_ARGS.length), [
    'exec', '-T', '-e', ADMIN_DATABASE_URL_VARIABLE, 'api', 'node', CREATE_USER_SCRIPT, '--email', DEFAULT_OWNER_EMAIL, '--admin',
  ]);
  assert.ok(args.every((argument) => !argument.includes('://')));
});

test('r3_5 adminDatabaseUrl points DATABASE_URL at the compose postgres service (O-294, O-331)', () => {
  const fromEnv = adminDatabaseUrl({ DATABASE_URL: 'postgres://postgres:s3cret@localhost:55432/gto?sslmode=disable' });
  assert.equal(fromEnv, 'postgres://postgres:s3cret@postgres:5432/gto?sslmode=disable');
  const fromFile = adminDatabaseUrl({}, 'OTHER=1\nDATABASE_URL="postgres://owner:pw@127.0.0.1:5432/gto"\n');
  assert.equal(fromFile, 'postgres://owner:pw@postgres:5432/gto');
  assert.throws(() => adminDatabaseUrl({}, 'OTHER=1\n'), OwnerSetupError);
  assert.throws(() => adminDatabaseUrl({ DATABASE_URL: 'not a url' }), OwnerSetupError);
});

test('r3_5 createOwnerEnv adds the admin URL to a new object and leaves the parent alone', () => {
  const parent = { PATH: '/bin' };
  const env = createOwnerEnv(parent, 'postgres://x@postgres:5432/gto');
  assert.deepEqual(env, { PATH: '/bin', [ADMIN_DATABASE_URL_VARIABLE]: 'postgres://x@postgres:5432/gto' });
  assert.deepEqual(parent, { PATH: '/bin' });
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

test('r3_13 the e2e chain creates the owner after the database steps, seeds its learning state, then smoke', () => {
  assert.deepEqual(STEPS, [
    'dev-up', 'db-migrate', 'db-test', 'fixture-solutions', 'fixture-queue', OWNER_STEP, LEARNING_STEP, 'smoke', 'e2e-web',
  ]);
});

test('r4_10 the learning seed step gets the owner email and never the password (O-324)', () => {
  const parent = Object.freeze({ PATH: '/usr/bin', [OWNER_PASSWORD_VARIABLE]: 'stale' });
  const child = learningStepEnv(parent, { email: DEFAULT_OWNER_EMAIL, password: 'pw-from-this-run-only' });
  assert.deepEqual(child, { PATH: '/usr/bin', [OWNER_EMAIL_VARIABLE]: DEFAULT_OWNER_EMAIL });
  assert.equal(parent[OWNER_PASSWORD_VARIABLE], 'stale');
});

test('r4_10 the Playwright step still gets the password after the learning step built its environment (O-324)', () => {
  const parent = { PATH: '/usr/bin' };
  const owner = { email: DEFAULT_OWNER_EMAIL, password: 'pw-from-this-run-only' };
  learningStepEnv(parent, owner);
  const web = e2eWebEnv(parent, owner);
  assert.equal(web[OWNER_PASSWORD_VARIABLE], owner.password);
  assert.equal(web[OWNER_EMAIL_VARIABLE], owner.email);
  assert.deepEqual(parent, { PATH: '/usr/bin' });
});

test('r3_5 adminDatabaseUrl treats an empty DATABASE_URL as unset and falls back to .env (PR #28 review L7)', () => {
  const url = adminDatabaseUrl({ DATABASE_URL: '' }, 'DATABASE_URL=postgres://owner:pw@localhost:5432/gto\n');
  assert.equal(url, 'postgres://owner:pw@postgres:5432/gto');
  assert.throws(() => adminDatabaseUrl({ DATABASE_URL: '  ' }, ''), OwnerSetupError);
});

test('r3_5 the e2e owner, admin URL included, is resolved before any step runs (PR #28 review L7)', () => {
  const owner = resolveOwner({ DATABASE_URL: 'postgres://o:p@127.0.0.1:5432/gto' }, '');
  assert.equal(owner.email, DEFAULT_OWNER_EMAIL);
  assert.equal(owner.adminUrl, 'postgres://o:p@postgres:5432/gto');
  assert.ok(owner.password.length >= MIN_PASSWORD_LENGTH);
  assert.throws(() => resolveOwner({}, ''), OwnerSetupError);
});
