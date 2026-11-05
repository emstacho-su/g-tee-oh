// R0.5: the one-shot wait reads compose ps output in both of its JSON shapes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composeArgs, findRow, main } from '../infra/compose/wait-one-shot.mjs';

const EXITED = { Service: 'bucket-init', State: 'exited', ExitCode: 0 };
const RUNNING = { Service: 'seaweedfs', State: 'running', ExitCode: 0 };

test('r0_5 findRow reads one JSON object per line', () => {
  const stdout = `${JSON.stringify(RUNNING)}\n${JSON.stringify(EXITED)}\n`;
  assert.deepEqual(findRow(stdout, 'bucket-init'), EXITED);
});

test('r0_5 findRow reads a JSON array from older compose releases', () => {
  assert.deepEqual(findRow(JSON.stringify([RUNNING, EXITED]), 'bucket-init'), EXITED);
});

test('r2_22 the profile is dev by default and mac for the Deploy 1 one-shots', () => {
  assert.deepEqual(composeArgs('mac').slice(-2), ['--profile', 'mac']);
  assert.deepEqual(composeArgs('dev').slice(-2), ['--profile', 'dev']);
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal(main('migrate-mac', 'prod'), 2);
    assert.equal(main(undefined), 2);
  } finally {
    console.error = error;
  }
});

test('r0_5 findRow returns null before the container exists', () => {
  assert.equal(findRow('', 'bucket-init'), null);
  assert.equal(findRow(JSON.stringify(RUNNING), 'bucket-init'), null);
});
