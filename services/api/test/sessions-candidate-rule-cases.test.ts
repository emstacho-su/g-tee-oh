/**
 * The candidate rule's shared cases (S47, R3.37, O-485): validation/fixtures/drills/
 * candidate-rule-cases.json restates which configurations and pairs a drill reaches
 * (sessions/candidates.ts). This test holds the api's functions to the file and
 * web/test/drills/reach-model.test.ts holds the web's reach model to the same file, so the two
 * cannot drift apart without one of them failing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { configRowMatches, pairsFor, type CatalogConfigRow } from "../src/sessions/candidates.js";
import type { Position } from "../src/catalog/seats.js";

interface RuleCase {
  readonly name: string;
  readonly filter: {
    readonly game_config: { readonly format: "online" | "live"; readonly table_size: number; readonly depths_bb: readonly number[] };
    readonly stake: string;
    readonly hero_positions: readonly Position[];
    readonly villain_positions: readonly Position[];
  };
  readonly expected: { readonly config_ids: readonly string[]; readonly pairs: readonly string[] };
}

interface RuleFile {
  readonly configs: readonly CatalogConfigRow[];
  readonly cases: readonly RuleCase[];
}

const FILE = join(process.cwd(), "..", "..", "validation", "fixtures", "drills", "candidate-rule-cases.json");
const file = JSON.parse(readFileSync(FILE, "utf8")) as RuleFile;

describe("R3.37 the candidate rule cases hold the api's functions", () => {
  it.each(file.cases.map((entry) => [entry.name, entry] as const))("R3.37 %s", (_name, entry) => {
    const filter = {
      ...entry.filter,
      game_config: { ...entry.filter.game_config, depths_bb: [...entry.filter.game_config.depths_bb] },
      hero_positions: [...entry.filter.hero_positions],
      villain_positions: [...entry.filter.villain_positions],
    };
    expect(pairsFor(filter)).toEqual(entry.expected.pairs);
    expect(file.configs.filter((row) => configRowMatches(filter, row)).map((row) => row.config_id)).toEqual(entry.expected.config_ids);
  });
});
