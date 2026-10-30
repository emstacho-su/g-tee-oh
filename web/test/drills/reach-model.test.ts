/**
 * What a drill reaches and how much of it the library covers (S47, R3.37, O-482, O-485): the web's
 * reach model counts (configuration, pair) spots from the two catalog reads with the api's candidate
 * rule, held to the shared cases of validation/fixtures/drills/candidate-rule-cases.json (the api
 * side runs the same file), and words the status line and the coverage badge from those counts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { badgeOf, configsReached, pairKeys, pairKeyOf, reachOf, reachText, type Reach } from "../../src/drills/reach-model.js";
import type { Position, SpotFilter } from "../../src/drills/types.js";
import { fixtureConfigs, fixturePairsByConfig } from "../../src/fixtures/study.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import type { GameConfig } from "../../src/progress/types.js";

interface RuleCase {
  readonly name: string;
  readonly filter: Pick<SpotFilter, "game_config" | "stake" | "hero_positions" | "villain_positions">;
  readonly expected: { readonly config_ids: readonly string[]; readonly pairs: readonly string[] };
}

interface RuleFile {
  readonly configs: readonly { config_id: string; format: GameConfig["format"]; table_size: number; stake_label: string; depth_cbb: number; ante_cbb: number }[];
  readonly cases: readonly RuleCase[];
}

const FILE = join(process.cwd(), "..", "validation", "fixtures", "drills", "candidate-rule-cases.json");
const file = JSON.parse(readFileSync(FILE, "utf8")) as RuleFile;
const configs: GameConfig[] = file.configs.map((row) => ({ ...row, stake_id: `stake-${row.stake_label}`, straddle: false }));

/** The api writes a pair out of position first; the web matches seats as a set, so both sides compare on the sorted seats. */
function seatSet(pair: string): string {
  return pair.split("-").sort().join("-");
}

const BTN_FILTER = fixtureDrill.spot_filter;

describe("R3.37 the reach model follows the api's candidate rule", () => {
  it.each(file.cases.map((entry) => [entry.name, entry] as const))("R3.37 %s", (_name, entry) => {
    expect(configsReached(entry.filter, configs).map((config) => config.config_id)).toEqual(entry.expected.config_ids);
    const { table_size: size } = entry.filter.game_config;
    expect(pairKeys(size, entry.filter.hero_positions, entry.filter.villain_positions)).toEqual(entry.expected.pairs.map(seatSet).sort());
  });

  it("R3.37 covered counts a pair once whatever seat order the read uses", () => {
    expect(pairKeyOf("BB", "BTN")).toBe(pairKeyOf("BTN", "BB"));
    const reach = reachOf({ ...BTN_FILTER, villain_positions: [] }, fixtureConfigs, fixturePairsByConfig);
    // The fixture catalog's cfg_6_online_100 holds BB-BTN and SB-BTN as available, CO-BTN not, UTG-HJ not.
    expect(reach).toEqual<Reach>({ spots: 5, covered: 2, missing: 3, configIds: ["cfg_6_online_100"] });
    const flipped = { ...fixturePairsByConfig, cfg_6_online_100: (fixturePairsByConfig["cfg_6_online_100"] ?? []).map((pair) => ({ ...pair, oop: pair.ip, ip: pair.oop })) };
    expect(reachOf({ ...BTN_FILTER, villain_positions: [] }, fixtureConfigs, flipped)?.covered).toBe(2);
  });

  it("R3.37 the reach is unknown while a reached configuration's pairs have not loaded, and empty when none is reached", () => {
    expect(reachOf({ ...BTN_FILTER, villain_positions: [] }, fixtureConfigs, {})).toBeUndefined();
    const nowhere = { ...BTN_FILTER, game_config: { ...BTN_FILTER.game_config, depths_bb: [137] } };
    expect(reachOf(nowhere, fixtureConfigs, {})).toEqual<Reach>({ spots: 0, covered: 0, missing: 0, configIds: [] });
    const twoConfigs = { ...BTN_FILTER, game_config: { ...BTN_FILTER.game_config, depths_bb: [100, 200] } };
    expect(reachOf(twoConfigs, fixtureConfigs, fixturePairsByConfig)).toEqual<Reach>({ spots: 2, covered: 2, missing: 0, configIds: ["cfg_6_online_100", "cfg_6_online_200"] });
  });

  it("R3.37 the status line words and the badge thresholds (O-482)", () => {
    expect(reachText({ spots: 5, covered: 2, missing: 3, configIds: ["a"] })).toBe("Reaches 5 spots; 2 covered, 3 not built yet.");
    expect(reachText({ spots: 1, covered: 1, missing: 0, configIds: ["a"] })).toBe("Reaches 1 spot; 1 covered, 0 not built yet.");
    expect(reachText({ spots: 0, covered: 0, missing: 0, configIds: [] })).toBe("Names no configuration in the catalog.");
    expect(badgeOf({ spots: 5, covered: 5, missing: 0, configIds: ["a"] })).toEqual({ kind: "covered", text: "Covered" });
    expect(badgeOf({ spots: 5, covered: 2, missing: 3, configIds: ["a"] })).toEqual({ kind: "partly", text: "Partly covered: 3 not built" });
    expect(badgeOf({ spots: 5, covered: 0, missing: 5, configIds: ["a"] })).toEqual({ kind: "none", text: "Not built yet" });
    expect(badgeOf({ spots: 0, covered: 0, missing: 0, configIds: [] })).toEqual({ kind: "no-config", text: "Not in the catalog" });
  });

  it("R3.37 configsReached skips ante configurations and matches depth, stake label, table size and format", () => {
    const withAnte: GameConfig[] = [...fixtureConfigs, { ...(fixtureConfigs[0] as GameConfig), config_id: "cfg_6_online_100_ante10", ante_cbb: 10 }];
    expect(configsReached(BTN_FILTER, withAnte).map((config) => config.config_id)).toEqual(["cfg_6_online_100"]);
    const heroes: Position[] = ["BTN"];
    expect(configsReached({ ...BTN_FILTER, stake: "1/3", hero_positions: heroes }, withAnte)).toEqual([]);
  });
});
