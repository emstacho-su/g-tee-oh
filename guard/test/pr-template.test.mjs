// R0.1: the pull request template carries the requirement identifier field.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { REPO_ROOT } from './helpers.mjs';

const template = readFileSync(join(REPO_ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');

test('r0_1 pull request template has the "R IDs closed:" field', () => {
  assert.ok(template.includes('R IDs closed:'));
});

test('r0_1 pull request template has the agreed sections', () => {
  for (const heading of ['## Summary', '## Requirement IDs', '## Tests run', '## Gates', '## Notes for the reviewer']) {
    assert.ok(template.includes(heading), `missing ${heading}`);
  }
});

test('r0_1 pull request template lists the gates as a checklist', () => {
  for (const gate of ['Plan approved', 'Tests green', 'Code review', 'Security review', 'Privacy guard']) {
    assert.match(template, new RegExp(`- \\[ \\] ${gate}`), `missing gate ${gate}`);
  }
});
