// @vitest-environment node
// Screen names are unique across the shot files (R3.13, R4.12, O-289). The file name of a shot is
// <screen>-<theme>-<width>.png and the manifest merges records by file, so two shot files that use
// the same screen name overwrite each other's pictures and criteria, whichever runs last winning.
// This reads the literal screen names from e2e/shots/*.shot.ts: shot("name", ...),
// shot(target, "name", ...) and the ["name", CRITERIA.x] tables.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "e2e", "shots");
const SCREEN_PATTERNS = [
  /shot\(\s*"([a-z0-9-]+)"/g,
  /shot\(\s*[A-Za-z_][\w.]*,\s*"([a-z0-9-]+)"/g,
  /\[\s*"([a-z0-9-]+)",\s*CRITERIA\./g,
];

function screensIn(source: string): string[] {
  return SCREEN_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function screenOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const file of readdirSync(SHOTS_DIR).filter((name) => name.endsWith(".shot.ts"))) {
    for (const screen of new Set(screensIn(readFileSync(join(SHOTS_DIR, file), "utf8")))) {
      owners.set(screen, [...(owners.get(screen) ?? []), file]);
    }
  }
  return owners;
}

describe("R4.12 shot screen names", () => {
  it("R4.12 finds the screen names of every shot form", () => {
    expect(screensIn(`shot("a-b", X); shot(page.locator, "c", X); ["d-1", CRITERIA.y]`)).toEqual(["a-b", "c", "d-1"]);
  });

  it("R4.12 no two shot files use the same screen name, so no picture overwrites another", () => {
    const owners = screenOwners();
    expect(owners.size).toBeGreaterThan(0);
    const shared = [...owners].filter(([, files]) => files.length > 1).map(([screen, files]) => `${screen}: ${files.join(", ")}`);
    expect(shared).toEqual([]);
  });
});
