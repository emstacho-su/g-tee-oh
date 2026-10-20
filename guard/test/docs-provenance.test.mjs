// R0.12: every mirrored planning file under docs/ carries the public: true flag in its
// frontmatter, and the manifest lists every mirrored file with its source.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

const repoDir = resolve(import.meta.dirname, '..', '..');
const docsDir = join(repoDir, 'docs');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function frontmatter(text) {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  return end < 0 ? '' : text.slice(3, end);
}

test('R0.12 every markdown file under docs/ is flagged public: true', () => {
  statSync(docsDir);
  const files = walk(docsDir);
  assert.ok(files.length > 0, 'docs/ holds at least one mirrored file');
  for (const file of files) {
    const fm = frontmatter(readFileSync(file, 'utf8'));
    assert.match(fm, /^public:\s*true\s*$/m, `${relative(repoDir, file)} lacks public: true`);
    assert.doesNotMatch(fm, /^private:\s*true\s*$/m, `${relative(repoDir, file)} is marked private`);
  }
});

test('R0.12 the mirror manifest names every mirrored file and its vault source', () => {
  const manifest = JSON.parse(readFileSync(join(docsDir, 'mirror-manifest.json'), 'utf8'));
  const listed = new Set(manifest.files.map((f) => f.path));
  const mirrored = walk(docsDir)
    .map((f) => relative(repoDir, f).split(sep).join('/'))
    .filter((p) => p !== 'docs/security.md' && p !== 'docs/README.md');
  for (const path of mirrored) {
    assert.ok(listed.has(path), `${path} is missing from docs/mirror-manifest.json`);
  }
  for (const entry of manifest.files) {
    assert.match(entry.source, /^vault\//, `${entry.path} has no vault source`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
});
