#!/usr/bin/env node
// Mirrors the planning files the vault flags as public into docs/ (R0.12, O-26, O-45).
//
// Mechanism: every markdown file under VAULT_DIR whose frontmatter carries the line
// "public: true" is copied to docs/<same relative path>. Nothing else is copied, so the
// flag in the vault is the only switch that publishes a file. A manifest records the
// source path and the sha256 of each copy so a reviewer can tell where a file came from,
// and the manifest is also the list of what the mirror owns: a copy whose flag was
// removed in the vault is deleted on the next run, while hand-written files under docs/
// are never touched. The private-data guard runs over docs/ afterwards (just docs-mirror).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync , realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_VAULT = 'C:/Users/stack/vault/projects/g-tee-oh';
export const MANIFEST_NAME = 'mirror-manifest.json';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function frontmatterIsPublic(text) {
  if (!text.startsWith('---')) return false;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return false;
  const block = text.slice(3, end);
  return /^public:\s*true\s*$/m.test(block) && !/^private:\s*true\s*$/m.test(block);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readPreviousManifest(docsDir) {
  const path = join(docsDir, MANIFEST_NAME);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed.files) ? parsed.files.map((entry) => entry.path) : [];
}

// Only paths the previous manifest listed are candidates for removal, and only when
// the vault no longer flags them. Empty directories left behind are removed too.
function removeStaleCopies(repoDir, docsDir, previousPaths, currentPaths) {
  const current = new Set(currentPaths);
  let removed = 0;
  for (const path of previousPaths) {
    if (current.has(path)) continue;
    const full = join(repoDir, path);
    if (!existsSync(full)) continue;
    rmSync(full);
    removed += 1;
    let dir = dirname(full);
    while (dir !== docsDir && existsSync(dir) && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true });
      dir = dirname(dir);
    }
  }
  return removed;
}

export function mirror({ vaultDir, repoDir }) {
  const docsDir = join(repoDir, 'docs');
  try {
    statSync(vaultDir);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`docs-mirror: VAULT_DIR ${vaultDir} does not exist`);
    throw error;
  }
  mkdirSync(docsDir, { recursive: true });
  const previousPaths = readPreviousManifest(docsDir);
  const manifest = [];
  for (const file of walk(vaultDir).sort()) {
    const text = readFileSync(file, 'utf8');
    if (!frontmatterIsPublic(text)) continue;
    const rel = relative(vaultDir, file).split(sep).join('/');
    const target = join(docsDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
    manifest.push({ path: `docs/${rel}`, source: `vault/${rel}`, sha256: sha256(Buffer.from(text, 'utf8')) });
  }
  const removed = removeStaleCopies(repoDir, docsDir, previousPaths, manifest.map((entry) => entry.path));
  const manifestText = `${JSON.stringify({ generated_by: 'guard/src/docs-mirror.mjs', rule: 'frontmatter public: true (O-26, O-45)', files: manifest }, null, 2)}\n`;
  writeFileSync(join(docsDir, MANIFEST_NAME), manifestText, 'utf8');
  return { copied: manifest.length, removed };
}

function main() {
  const vaultDir = resolve(process.env.VAULT_DIR ?? DEFAULT_VAULT);
  const repoDir = resolve(process.env.REPO_DIR ?? process.cwd());
  try {
    const { copied, removed } = mirror({ vaultDir, repoDir });
    console.log(`docs-mirror: copied ${copied} flagged files from the vault into docs/ (removed ${removed} stale copies)`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

// Real paths on both sides: node resolves symlinks for the main module while
// process.argv[1] keeps the path as typed, and a mismatch would skip main().
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  process.exitCode = main();
}
