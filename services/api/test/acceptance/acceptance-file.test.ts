/**
 * The drill acceptance file format (R3.15, O-315): the loader accepts a well-formed file and
 * rejects a missing file, bad JSON, an unknown key, a duplicate case name and a wrong version,
 * each with a message naming the file and the cause; a case's drill is expressed (or not) by the
 * DrillCreate schema; a relative path resolves against the repository root. Pure: no database.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  AcceptanceFileError,
  DEFAULT_ACCEPTANCE_FILE,
  expressDrill,
  lineAndColumn,
  loadAcceptanceFile,
  REPO_ROOT,
  resolveAcceptancePath,
} from "./acceptance-file.js";

const DRILL = {
  name: "acceptance file test drill",
  tags: ["synthetic"],
  spot_filter: {
    game_config: { format: "online", table_size: 6, depths_bb: [100] },
    stake: "online",
    sizing: { mode: "convention" },
    start_street: "preflop",
    hero_positions: ["BTN"],
    villain_positions: [],
    preflop_action: ["rfi"],
    hands: { mode: "all" },
    alternate_seats: false,
  },
  trainer: {
    stop_rule: "after_action",
    input: "actions",
    grouping: "standard",
    rng: false,
    pause: "never",
    speed: "normal",
    quick_result: false,
    tables: 1,
    timebank_s: null,
    panels: {},
  },
};

function file(cases: unknown[] = [{ name: "one", drill: DRILL }], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, source: "synthetic", library_note: "the fixture library", cases, ...extra };
}

const directory = mkdtempSync(join(tmpdir(), "drill-acceptance-"));

function written(name: string, text: string): string {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

function loadError(path: string): AcceptanceFileError {
  try {
    loadAcceptanceFile(path);
  } catch (error: unknown) {
    if (error instanceof AcceptanceFileError) return error;
    throw error;
  }
  throw new Error(`${path} loaded`);
}

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("R3.15 the drill acceptance file", () => {
  it("R3.15 a well-formed file loads with its cases in order", () => {
    const path = written("good.json", JSON.stringify(file([{ name: "a", drill: DRILL }, { name: "b", drill: DRILL, note: "why" }])));
    const loaded = loadAcceptanceFile(path);
    expect(loaded.cases.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(loaded.cases[1]?.note).toBe("why");
  });

  it("R3.15 a missing file is rejected naming the path", () => {
    const path = join(directory, "absent.json");
    const error = loadError(path);
    expect(error.message).toContain(path);
    expect(error.message).toMatch(/cannot be read/);
  });

  it("R3.15 a file that is not JSON is rejected", () => {
    const error = loadError(written("bad.json", "{ version: 1,"));
    expect(error.message).toMatch(/not valid JSON/);
  });

  it("R3.15 bad JSON is reported only as a line and column, never the parser's text or the file's (LOW 7)", () => {
    const path = written("bad-line.json", '{\n  "version": 1,\n  zzfilecontentzz: true\n}');
    const error = loadError(path);
    expect(error.message).toBe(`the acceptance file ${path} is not valid JSON (line 3, column 3)`);
    expect(error.message).not.toContain("zzfilecontentzz");
  });

  it("R3.15 truncated JSON is reported at the end of the file (LOW 7)", () => {
    const path = written("truncated.json", '{\n  "version": 1,');
    expect(loadError(path).message).toBe(`the acceptance file ${path} is not valid JSON (line 2, column 16)`);
  });

  it("R3.15 a path not ending in .json is refused before it is read (LOW 7)", () => {
    const present = written("cases.txt", JSON.stringify(file()));
    expect(loadError(present).message).toBe(`the acceptance file ${present} is not a .json file`);
    const absent = join(directory, "absent.yaml");
    expect(loadError(absent).message).toBe(`the acceptance file ${absent} is not a .json file`);
  });

  it("R3.15 lineAndColumn turns an offset into a line and column", () => {
    expect(lineAndColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
    expect(lineAndColumn("abc", 0)).toEqual({ line: 1, column: 1 });
  });

  it("R3.15 an unknown top-level key is rejected", () => {
    const error = loadError(written("unknown-top.json", JSON.stringify(file(undefined, { extra: true }))));
    expect(error.message).toMatch(/extra/);
  });

  it("R3.15 an unknown case key is rejected", () => {
    const error = loadError(written("unknown-case.json", JSON.stringify(file([{ name: "a", drill: DRILL, expect: 1 }]))));
    expect(error.message).toMatch(/cases\.0/);
    expect(error.message).toMatch(/expect/);
  });

  it("R3.15 a duplicate case name is rejected", () => {
    const error = loadError(written("duplicate.json", JSON.stringify(file([{ name: "a", drill: DRILL }, { name: "a", drill: DRILL }]))));
    expect(error.message).toMatch(/cases\.1\.name/);
    expect(error.message).toMatch(/more than once/);
  });

  it("R3.15 a version other than 1, no cases, or a drill that is not an object is rejected", () => {
    expect(loadError(written("v2.json", JSON.stringify({ ...file(), version: 2 }))).message).toMatch(/version/);
    expect(loadError(written("empty.json", JSON.stringify(file([])))).message).toMatch(/cases/);
    expect(loadError(written("drill-array.json", JSON.stringify(file([{ name: "a", drill: [] }])))).message).toMatch(/cases\.0\.drill/);
  });

  it("R3.15 a drill is expressed only when DrillCreate accepts it", () => {
    expect(expressDrill(DRILL).success).toBe(true);
    const typo = { ...DRILL, spot_filter: { ...DRILL.spot_filter, hero_position: ["BTN"] } };
    const failed = expressDrill(typo);
    expect(failed.success).toBe(false);
    const unseated = { ...DRILL, spot_filter: { ...DRILL.spot_filter, hero_positions: ["LJ"] } };
    expect(expressDrill(unseated).success).toBe(false);
  });

  it("R3.15 a relative path resolves against the repository root and an absolute one is kept", () => {
    const relative = resolveAcceptancePath(DEFAULT_ACCEPTANCE_FILE);
    expect(isAbsolute(relative)).toBe(true);
    expect(relative).toBe(join(REPO_ROOT, DEFAULT_ACCEPTANCE_FILE));
    expect(resolveAcceptancePath(directory)).toBe(directory);
    expect(resolveAcceptancePath(undefined)).toBe(relative);
    expect(resolveAcceptancePath("  ")).toBe(relative);
  });

  it("R3.15 the committed synthetic drill set loads", () => {
    const loaded = loadAcceptanceFile(resolveAcceptancePath(undefined));
    expect(loaded.source).toBe("synthetic");
    expect(loaded.cases.length).toBeGreaterThan(0);
    for (const entry of loaded.cases) expect(expressDrill(entry.drill).success, entry.name).toBe(true);
  });
});
