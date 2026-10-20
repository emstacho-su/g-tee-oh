#!/usr/bin/env node
// Mirrors the planning files the vault flags as public into docs/ (R0.12, O-26, O-45).
//
// Mechanism: every markdown file under VAULT_DIR whose frontmatter carries the line
// "public: true" is copied to docs/<same relative path>. Nothing else is copied, so the
// flag in the vault is the only switch that publishes a file. A manifest records the
// source path and the sha256 of each copy so a reviewer can tell where a file came from.
// The private-data guard is run over docs/ afterwards by the caller (just guard-paths docs).

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const DEFAULT_VAULT = 'C:/Users/stack/vault/projects/g-tee-oh';
const vaultDir = resolve(process.env.VAULT_DIR ?? DEFAULT_VAULT);
const repoDir = resolve(process.env.REPO_DIR ?? process.cwd());
const docsDir = join(repoDir, 'docs');
const KEEP = new Set(['security.md', 'mirror-manifest.json', 'README.md']);

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

function clearStaleMirror() {
  // Remove previously mirrored files so a flag removed in the vault also removes the copy.
  let removed = 0;
  const walkDocs = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDocs(full);
        if (readdirSync(full).length === 0) rmSync(full, { recursive: true });
      } else if (!KEEP.has(relative(docsDir, full).split(sep).join('/'))) {
        rmSync(full);
        removed += 1;
      }
    }
  };
  try {
    statSync(docsDir);
    walkDocs(docsDir);
  } catch {
    // docs/ does not exist yet
  }
  return removed;
}

function main() {
  try {
    statSync(vaultDir);
  } catch {
    console.error(`docs-mirror: VAULT_DIR ${vaultDir} does not exist`);
    process.exit(2);
  }
  const removed = clearStaleMirror();
  mkdirSync(docsDir, { recursive: true });
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
  const manifestText = `${JSON.stringify({ generated_by: 'guard/src/docs-mirror.mjs', rule: 'frontmatter public: true (O-26, O-45)', files: manifest }, null, 2)}\n`;
  writeFileSync(join(docsDir, 'mirror-manifest.json'), manifestText, 'utf8');
  console.log(`docs-mirror: copied ${manifest.length} flagged files from the vault into docs/ (removed ${removed} stale copies)`);
}

main();
