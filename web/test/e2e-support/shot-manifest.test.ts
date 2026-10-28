// @vitest-environment node
// Tests for e2e/support/shot-manifest.ts (R3.12, R3.13, O-289): several Playwright files merge
// their screenshot records into one manifest.json for the owner's review page.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MANIFEST_FILE,
  mergeShotManifest,
  mergeShotRecords,
  readShotManifest,
  shotDirectory,
  type ShotRecord,
} from "../../e2e/support/shot-manifest.js";

function record(file: string, criterion = "a criterion"): ShotRecord {
  return { screen: file, theme: "light", width: 1440, height: 900, file, criterion, source: "mock" };
}

const NOW = new Date("2026-10-28T12:00:00Z");
const directories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "shot-manifest-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("R3.13 shot manifest merge (O-289)", () => {
  it("R3.13 replaces a record with the same file and keeps the others, sorted by file", () => {
    const first = mergeShotRecords(null, "S24", [record("b.png"), record("a.png")], "/shots", NOW);
    const second = mergeShotRecords(first, "S25", [record("b.png", "updated"), record("c.png")], "/shots", NOW);
    expect(second.shots.map((shot) => `${shot.file}:${shot.criterion}`)).toEqual([
      "a.png:a criterion",
      "b.png:updated",
      "c.png:a criterion",
    ]);
    expect(second.sessions).toEqual(["S24", "S25"]);
    expect(second.generated).toBe(NOW.toISOString());
  });

  it("R3.13 writes and reads back one manifest across two writers", () => {
    const directory = tempDirectory();
    mergeShotManifest(directory, "S24", [record("one.png")]);
    mergeShotManifest(directory, "S25", [record("two.png")]);
    const manifest = readShotManifest(directory);
    expect(manifest?.shots.map((shot) => shot.file)).toEqual(["one.png", "two.png"]);
    expect(JSON.parse(readFileSync(join(directory, MANIFEST_FILE), "utf8"))).toMatchObject({ sessions: ["S24", "S25"] });
  });

  it("R3.13 a missing manifest reads as null and an unreadable one is replaced", () => {
    const directory = tempDirectory();
    expect(readShotManifest(directory)).toBeNull();
    writeFileSync(join(directory, MANIFEST_FILE), "{ not json");
    expect(readShotManifest(directory)).toBeNull();
    expect(mergeShotManifest(directory, "S25", [record("x.png")]).shots).toHaveLength(1);
  });

  it("R3.13 the shot folder is SCREENSHOT_DIR when set, else test-results/shots", () => {
    expect(shotDirectory({ SCREENSHOT_DIR: "/tmp/shots-here" })).toMatch(/shots-here$/);
    expect(shotDirectory({})).toMatch(/test-results[\\/]shots$/);
  });
});
