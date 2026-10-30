/**
 * The web's bundled starter codes against the real encoder (S47, R3.35, O-481): every code in
 * web/src/drills/starter-pack.ts decodes with decodeExportCode, encodes back to the same text
 * (canonical JSON gives one code per drill), and the acceptance cases of
 * validation/fixtures/drills/starter-pack.json encode to codes the web bundles. The web file is
 * read as text (the drift-test pattern of the progress tests), so a code edited by hand or a case
 * changed in the fixture fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeExportCode, encodeExportCode } from "../src/drills/export-code.js";
import { drillCreateBodySchema } from "../src/schemas/drills.js";

interface AcceptanceFile {
  readonly cases: readonly { readonly name: string; readonly drill: unknown }[];
}

/** Vitest runs from services/api; the repo root is two levels up. */
const ROOT = join(process.cwd(), "..", "..");
const WEB_PACK_FILE = join(ROOT, "web", "src", "drills", "starter-pack.ts");
const ACCEPTANCE_FILE = join(ROOT, "validation", "fixtures", "drills", "starter-pack.json");
const CODE_PATTERN = /gteeoh1\.[A-Za-z0-9_-]+/g;
const SQUEEZE_CODES = 1;

const bundled = readFileSync(WEB_PACK_FILE, "utf8").match(CODE_PATTERN) ?? [];
const acceptance = JSON.parse(readFileSync(ACCEPTANCE_FILE, "utf8")) as AcceptanceFile;

describe("R3.35 the real encoder reproduces every bundled starter code and decodes it back", () => {
  it("R3.35 each bundled code decodes to a drill the write rules accept and encodes to the same text", () => {
    expect(bundled.length).toBe(acceptance.cases.length + SQUEEZE_CODES);
    for (const code of bundled) {
      const drill = decodeExportCode(code);
      expect(encodeExportCode(drill)).toBe(code);
    }
  });

  it("R3.35 each acceptance case encodes to a bundled code", () => {
    for (const entry of acceptance.cases) {
      const code = encodeExportCode(drillCreateBodySchema.parse(entry.drill));
      expect(bundled, entry.name).toContain(code);
    }
  });
});
