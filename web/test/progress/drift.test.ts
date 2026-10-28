// Drift tests for the naming data the click to drill copies (S32, R4.12, O-321): the api's drill
// family table, gto-model's depth band edges and names, and the seat lists. Each reads the source
// it copies as text, so a change there fails here before a drill is built wrong.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { seatedPositions } from "../../src/drills/limits.js";
import { DEPTH_BAND_EDGES_CBB, DEPTH_BANDS, DRILL_ACTION_FOR_FAMILY } from "../../src/progress/drill-family.js";

const REPO_ROOT = join(process.cwd(), "..");
const BLIND_VS_BLIND = "blind-vs-blind";

function repoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function quoted(list: string): string[] {
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

function block(text: string, start: RegExp): string {
  const match = start.exec(text);
  if (match === null) throw new Error(`no ${start.source} in the source`);
  const from = match.index + match[0].length;
  return text.slice(from, text.indexOf("};", from));
}

describe("R4.12 drill family drift (services/api/src/sessions/action-family.ts)", () => {
  const source = repoFile("services/api/src/sessions/action-family.ts");
  const rustFamilies = quoted(block(source, /export const RUST_ACTION_FAMILIES = \[/).split("]")[0] ?? "");
  const table = Object.fromEntries(
    [...block(source, /export const DRILL_FAMILY_TABLE[^=]*= \{/).matchAll(/^\s*(\w+): \[([^\]]*)\]/gm)].map((match) => [match[1] ?? "", quoted(match[2] ?? "")]),
  );

  it("R4.12 the api lists the eight Rust families and nine drill families this copy reads", () => {
    expect(rustFamilies).toHaveLength(8);
    expect(Object.keys(table)).toHaveLength(9);
    expect(source).toContain(`const BLIND_VS_BLIND: RustActionFamily = "${BLIND_VS_BLIND}";`);
  });

  it("R4.12 every Rust family has a drill family the api maps back to it", () => {
    expect(Object.keys(DRILL_ACTION_FOR_FAMILY).sort()).toEqual([...rustFamilies].sort());
    for (const family of rustFamilies) {
      const drill = DRILL_ACTION_FOR_FAMILY[family];
      expect(drill, family).toBeDefined();
      const accepted = table[drill ?? ""];
      expect(accepted, `${family} -> ${drill}`).toBeDefined();
      if (family !== BLIND_VS_BLIND) expect(accepted, `${family} -> ${drill}`).toContain(family);
    }
  });

  it("R4.12 the drill family picked accepts that family alone wherever the api has such a family", () => {
    for (const family of rustFamilies.filter((name) => name !== BLIND_VS_BLIND)) {
      const alone = Object.entries(table).some(([, accepted]) => accepted.length === 1 && accepted[0] === family);
      const picked = table[DRILL_ACTION_FOR_FAMILY[family] ?? ""] ?? [];
      if (alone) expect(picked, family).toEqual([family]);
    }
  });
});

describe("R4.12 depth band drift (crates/gto-model/src/spot_class.rs)", () => {
  const source = repoFile("crates/gto-model/src/spot_class.rs");

  it("R4.12 the band edges equal DepthBand::EDGES_CBB", () => {
    const match = /pub const EDGES_CBB: \[u32; \d+\] = \[([^\]]+)\];/.exec(source);
    const edges = (match?.[1] ?? "").split(",").map((edge) => Number(edge.trim().replaceAll("_", "")));
    expect(edges).toEqual([...DEPTH_BAND_EDGES_CBB]);
  });

  it("R4.12 the band names equal DepthBand::as_str, shallowest first", () => {
    const names = [...source.matchAll(/DepthBand::\w+ => "([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([...DEPTH_BANDS]);
  });
});

describe("R4.12 seat list drift (services/api/src/catalog/seats.ts)", () => {
  it("R4.12 the web's seats by table size (S26's limits.ts, which the pair match reads) equal the api's copy of Position::seated", () => {
    const source = block(repoFile("services/api/src/catalog/seats.ts"), /const SEATED[^=]*= \{/);
    const entries = [...source.matchAll(/^\s*(\d): \[([^\]]*)\]/gm)].map((match) => [Number(match[1]), quoted(match[2] ?? "")] as const);
    expect(entries).toHaveLength(8);
    for (const [size, seats] of entries) expect(seatedPositions(size), `table size ${size}`).toEqual(seats);
  });
});
