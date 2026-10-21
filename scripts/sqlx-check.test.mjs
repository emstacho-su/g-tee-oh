// Tests for scripts/sqlx-check.mjs (R0.6, O-147): the scanner triggers on a sqlx query
// macro call and never on the dependency line, a runtime-checked sqlx::query call or a
// comment, and the committed tree carries no macro today, so the check passes without
// sqlx-cli. node:test, run by `pnpm run test:scripts` (just ts-test).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { EXIT_OK, MACRO_USE, findMacroUses, withoutLineComments } from "./sqlx-check.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "sqlx-check.mjs");
const REPO_ROOT = resolve(dirname(SCRIPT), "..");

const MANIFEST = '[package]\nname = "x"\n[dependencies]\nsqlx = "0.8"\n';
const RUNTIME_CHECKED =
  'let rows = sqlx::query("select 1").fetch_all(pool).await?;\n// query!("not a call")\n';
const MACRO_CHECKED = 'let row = sqlx::query_as!(Row, "select 1").fetch_one(pool).await?;\n';

let root;

function crate(name, source) {
  const dir = join(root, "services", name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "Cargo.toml"), MANIFEST);
  writeFileSync(join(dir, "src", "lib.rs"), source);
  return join(dir, "src", "lib.rs");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sqlx-check-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("R0.6 the macro pattern matches query macro calls and not runtime-checked calls", () => {
  const calls = [
    "sqlx::query!(",
    "query_as!( ",
    "sqlx::query_file_scalar!(",
    "query_scalar_unchecked!(",
  ];
  for (const call of calls) {
    assert.ok(MACRO_USE.test(call), call);
  }
  for (const call of ["sqlx::query(", "query_as(", "sqlx::query_builder!(", "my_query!("]) {
    assert.equal(MACRO_USE.test(call), false, call);
  }
  assert.equal(withoutLineComments("a // query!(\nb"), "a \nb");
});

test("R0.6 findMacroUses reports the file calling a macro and ignores the dependency line", () => {
  crate("runtime", RUNTIME_CHECKED);
  assert.deepEqual(findMacroUses(root), []);
  const macro = crate("macro", MACRO_CHECKED);
  assert.deepEqual(findMacroUses(root), [macro]);
});

test("R0.6 the committed tree calls no query macro, so the check passes without sqlx-cli", () => {
  assert.deepEqual(findMacroUses(REPO_ROOT), []);
  crate("runtime", RUNTIME_CHECKED);
  const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.stdout, /no crate calls a sqlx query macro/);
});
