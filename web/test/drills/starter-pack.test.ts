/**
 * The starter drill pack (S47, R3.35, O-481): the bundled export codes decode to drills the write
 * rules accept, each names a configuration both the fixture library and the mock catalog serve,
 * and the codes are the cases of validation/fixtures/drills/starter-pack.json (the acceptance
 * file that proves each runs on the fixture library) plus the squeeze drill the synthetic pair
 * trees cannot serve (ADR 0018: it is listed with its reason, never hidden).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeMockExportCode } from "../../e2e/support/mock-drills.js";
import { checkDrillBody } from "../../src/drills/body-rules.js";
import { MAX_EXPORT_CODE_LENGTH } from "../../src/drills/limits.js";
import { configsReached } from "../../src/drills/reach-model.js";
import { missingStarterDrills, STARTER_PACK, STARTER_TAG, starterIdTag, type StarterDrill } from "../../src/drills/starter-pack.js";
import type { DrillCreate } from "../../src/drills/types.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import type { GameConfig } from "../../src/progress/types.js";

interface AcceptanceFile {
  readonly cases: readonly { readonly name: string; readonly drill: DrillCreate }[];
}

/** Vitest runs from web/, so the fixtures sit at ../validation. */
const FIXTURES = join(process.cwd(), "..", "validation", "fixtures");
const acceptance = JSON.parse(readFileSync(join(FIXTURES, "drills", "starter-pack.json"), "utf8")) as AcceptanceFile;

/** The configurations validation/fixtures/library serves (its README, "What it holds"), as the catalog rows the api would list. */
const FIXTURE_LIBRARY_CONFIGS: readonly GameConfig[] = [
  { config_id: "cfg_6_online_100", format: "online", table_size: 6, stake_id: "s", stake_label: "online", depth_cbb: 10_000, straddle: false, ante_cbb: 0 },
  { config_id: "cfg_6_online_150", format: "online", table_size: 6, stake_id: "s", stake_label: "online", depth_cbb: 15_000, straddle: false, ante_cbb: 0 },
  { config_id: "cfg_6_online_200", format: "online", table_size: 6, stake_id: "s", stake_label: "online", depth_cbb: 20_000, straddle: false, ante_cbb: 0 },
  { config_id: "cfg_9_live_13_100", format: "live", table_size: 9, stake_id: "l", stake_label: "1/3", depth_cbb: 10_000, straddle: false, ante_cbb: 0 },
  { config_id: "cfg_9_live_25_100", format: "live", table_size: 9, stake_id: "m", stake_label: "2/5", depth_cbb: 10_000, straddle: false, ante_cbb: 0 },
];

const MIN_PACK = 8;
const MAX_PACK = 12;
const SQUEEZE_NAME = "Squeeze from the blinds";

function decoded(entry: StarterDrill): DrillCreate {
  const result = decodeMockExportCode(entry.code);
  if ("detail" in result) throw new Error(`${entry.name}: ${result.detail}`);
  return result.body;
}

describe("R3.35 the starter drill pack", () => {
  it("R3.35 every bundled starter code decodes to a drill the write rules accept", () => {
    expect(STARTER_PACK.length).toBeGreaterThanOrEqual(MIN_PACK);
    expect(STARTER_PACK.length).toBeLessThanOrEqual(MAX_PACK);
    expect(new Set(STARTER_PACK.map((entry) => entry.key)).size).toBe(STARTER_PACK.length);
    for (const entry of STARTER_PACK) {
      expect(entry.code.length).toBeLessThanOrEqual(MAX_EXPORT_CODE_LENGTH);
      const body = decoded(entry);
      expect(checkDrillBody(body)).toEqual([]);
      expect(body.name).toBe(entry.name);
      expect(body.tags).toContain(STARTER_TAG);
      // A stable id the drill keeps through a rename (PR #48 review 4 finding 3).
      expect(body.tags).toContain(starterIdTag(entry));
    }
  });

  it("R3.35 every starter drill names a configuration the fixture library and the mock catalog serve", () => {
    for (const entry of STARTER_PACK) {
      const filter = decoded(entry).spot_filter;
      expect(configsReached(filter, FIXTURE_LIBRARY_CONFIGS).map((config) => config.config_id), entry.name).not.toEqual([]);
      expect(configsReached(filter, fixtureConfigs).map((config) => config.config_id), entry.name).not.toEqual([]);
    }
  });

  it("R3.35 the bundled codes are the starter-pack.json cases, one code per case plus the squeeze", () => {
    const byName = new Map(STARTER_PACK.map((entry) => [entry.name, decoded(entry)]));
    for (const entry of acceptance.cases) {
      expect(byName.get(entry.name), entry.name).toEqual(entry.drill);
    }
    const extra = STARTER_PACK.map((entry) => entry.name).filter((name) => !acceptance.cases.some((entry) => entry.name === name));
    expect(extra).toEqual([SQUEEZE_NAME]);
    expect(byName.get(SQUEEZE_NAME)?.spot_filter.preflop_action).toEqual(["squeeze"]);
  });

  it("R3.35 a starter drill counts as present by its id tag, so a renamed one is not offered again (PR #48 review 4 finding 3)", () => {
    const [first, second, third] = STARTER_PACK;
    if (first === undefined || second === undefined || third === undefined) throw new Error("the pack has fewer than three drills");
    const listed = [
      // Renamed by the user: the id tag still names it.
      { name: "My opening ranges", tags: [STARTER_TAG, starterIdTag(first)] },
      // Imported before the id tags: its name still counts.
      { name: second.name, tags: [STARTER_TAG] },
    ];
    const missing = missingStarterDrills(listed).map((entry) => entry.key);
    expect(missing).not.toContain(first.key);
    expect(missing).not.toContain(second.key);
    expect(missing).toContain(third.key);
    expect(missing).toHaveLength(STARTER_PACK.length - 2);
  });
});
