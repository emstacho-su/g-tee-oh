/**
 * Writes the OpenAPI (Open Application Programming Interface) document to the path after --out
 * (R0.7, O-116). The process writes the file itself through node:fs; shell redirection is never
 * used because PowerShell's > emits UTF-16. just contracts runs the bundled copy,
 * dist/openapi-export.js, and the committed packages/contracts/api.openapi.json is diff-checked
 * against it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { buildApp } from "./app.js";

const OUT_FLAG = "--out";
const JSON_INDENT = 2;
const USAGE = "usage: openapi-export --out <path>";

function readOutPath(argv: readonly string[]): string | undefined {
  const flagIndex = argv.indexOf(OUT_FLAG);
  if (flagIndex === -1) {
    return undefined;
  }
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const outPath = readOutPath(process.argv.slice(2));
if (outPath === undefined) {
  console.error(USAGE);
  process.exit(1);
}

const app = buildApp();
try {
  await app.ready();
  const document = app.swagger();
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(document, null, JSON_INDENT)}\n`, "utf8");
} catch (error: unknown) {
  console.error(`openapi-export failed: ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
