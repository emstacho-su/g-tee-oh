/**
 * One screenshot manifest across runs (S25, O-289, O-67). The PM's review page reads
 * <SCREENSHOT_DIR>/manifest.json; several Playwright files (the S24 screens, the S25 study and
 * trainer shots) and two projects (shots over the mocked api, the stack flows over the fixture
 * library) all write screenshots into the same folder.
 *
 * Mechanism: each writer collects its records and calls mergeShotManifest once in afterAll. The
 * merge reads the existing manifest (a missing or unreadable one counts as empty), replaces any
 * record with the same file path and appends the rest, sorted by file, then writes the whole
 * file back. Playwright runs one worker (playwright.config.ts), so writers never race. Each
 * record names its source (mock or stack) and the acceptance criterion it shows.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Theme = "light" | "dark";
export type ShotSource = "mock" | "stack";

export interface ShotRecord {
  screen: string;
  theme: Theme;
  width: number;
  height: number;
  file: string;
  criterion: string;
  source: ShotSource;
}

export interface ShotManifest {
  sessions: string[];
  generated: string;
  directory: string;
  shots: ShotRecord[];
}

export const MANIFEST_FILE = "manifest.json";
const DEFAULT_SHOT_DIR = "test-results/shots";

/** The screenshot folder: SCREENSHOT_DIR when set, else test-results/shots. */
export function shotDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment["SCREENSHOT_DIR"];
  return resolve(configured === undefined || configured === "" ? DEFAULT_SHOT_DIR : configured);
}

function isShotRecord(value: unknown): value is ShotRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["file"] === "string" && typeof record["screen"] === "string";
}

/** The manifest already in the folder, or null when there is none or it cannot be read. */
export function readShotManifest(directory: string): ShotManifest | null {
  const path = join(directory, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ShotManifest>;
    const shots = Array.isArray(parsed.shots) ? parsed.shots.filter(isShotRecord) : [];
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions.filter((entry) => typeof entry === "string") : [];
    return { sessions, generated: String(parsed.generated ?? ""), directory, shots };
  } catch (error: unknown) {
    // An unreadable manifest is replaced, never silently kept half-merged; say so in the run log.
    console.warn(`shot manifest at ${path} was unreadable and is rewritten: ${String(error)}`);
    return null;
  }
}

/** The manifest with these records merged in by file path (pure). */
export function mergeShotRecords(
  existing: ShotManifest | null,
  session: string,
  records: readonly ShotRecord[],
  directory: string,
  now: Date,
): ShotManifest {
  const byFile = new Map((existing?.shots ?? []).map((record) => [record.file, record]));
  for (const record of records) byFile.set(record.file, record);
  const sessions = [...new Set([...(existing?.sessions ?? []), session])].sort();
  const shots = [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
  return { sessions, generated: now.toISOString(), directory, shots };
}

/** Merges records into <directory>/manifest.json and writes it. */
export function mergeShotManifest(directory: string, session: string, records: readonly ShotRecord[]): ShotManifest {
  mkdirSync(directory, { recursive: true });
  const manifest = mergeShotRecords(readShotManifest(directory), session, records, directory, new Date());
  writeFileSync(join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
