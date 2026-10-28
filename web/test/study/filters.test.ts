// Tests for the study filters (S25, R3.12, O-286): the options each select offers, how a format,
// table size, stake and depth resolve to one config_id, uncovered pairs shown disabled, and the
// search updates a filter change makes.
import { describe, expect, it } from "vitest";

import {
  FILTER_PROMPTS,
  depthOptions,
  missingFilter,
  pairOptions,
  resolveConfigId,
  stakeOptions,
  tableSizeOptions,
  withFilter,
  withHand,
  withLine,
  withMode,
} from "../../src/study/filters.js";
import {
  FIXTURE_DEEP_CONFIG_ID,
  FIXTURE_LIVE_STAKE_ID,
  FIXTURE_ONLINE_STAKE_ID,
  FIXTURE_STUDY_CONFIG_ID,
  fixtureConfigs,
  fixturePairsByConfig,
  fixtureStakes,
} from "../../src/fixtures/study.js";
import type { GameConfig } from "../../src/study/queries.js";

const ONLINE = fixtureConfigs.filter((config) => config.format === "online");
const FULL = {
  format: "online",
  table_size: 6,
  stake: FIXTURE_ONLINE_STAKE_ID,
  depth: 10000,
  pair: "BB-BTN",
  line: "r250",
  mode: "ev",
  hand: "AKs",
} as const;

describe("R3.12 study filter options", () => {
  it("R3.12 table sizes are the distinct sizes of the format's configurations, ascending", () => {
    const nine: GameConfig = { ...fixtureConfigs[0]!, config_id: "cfg_x", table_size: 9 };
    expect(tableSizeOptions([...ONLINE, nine])).toEqual([
      { value: "6", label: "6 players" },
      { value: "9", label: "9 players" },
    ]);
  });

  it("R3.12 stakes are the format's stakes that have a configuration at the table size", () => {
    expect(stakeOptions(fixtureStakes, ONLINE, 6)).toEqual([{ value: FIXTURE_ONLINE_STAKE_ID, label: "online" }]);
    expect(stakeOptions(fixtureStakes, ONLINE, 9)).toEqual([]);
    const live = fixtureConfigs.filter((config) => config.format === "live");
    expect(stakeOptions(fixtureStakes, live, 9)).toEqual([{ value: FIXTURE_LIVE_STAKE_ID, label: "1/3" }]);
  });

  it("R3.12 depths list each configuration's depth in big blinds", () => {
    expect(depthOptions(ONLINE, 6, FIXTURE_ONLINE_STAKE_ID)).toEqual([
      { value: "10000", label: "100bb" },
      { value: "20000", label: "200bb" },
    ]);
  });

  it("R3.12 the four filters resolve one config_id, preferring the configuration without a straddle", () => {
    expect(resolveConfigId(ONLINE, FULL)).toBe(FIXTURE_STUDY_CONFIG_ID);
    expect(resolveConfigId(ONLINE, { ...FULL, depth: 20000 })).toBe(FIXTURE_DEEP_CONFIG_ID);
    const straddled: GameConfig = { ...fixtureConfigs[0]!, config_id: "cfg_straddle", straddle: true };
    expect(resolveConfigId([straddled, ...ONLINE], FULL)).toBe(FIXTURE_STUDY_CONFIG_ID);
    expect(resolveConfigId(ONLINE, { ...FULL, depth: 15000 })).toBeUndefined();
    expect(resolveConfigId(ONLINE, { format: "online", table_size: 6 })).toBeUndefined();
  });

  it("R3.12 pairs without a preflop solution are disabled and labeled Not in the library", () => {
    const options = pairOptions(fixturePairsByConfig[FIXTURE_STUDY_CONFIG_ID]!);
    expect(options).toContainEqual({ value: "BB-BTN", label: "BB-BTN", disabled: false });
    expect(options).toContainEqual({ value: "CO-BTN", label: "CO-BTN (Not in the library)", disabled: true });
  });

  it("R3.12 the screen asks for the first missing filter, in filter order", () => {
    expect(missingFilter({}, undefined)).toBe("format");
    expect(missingFilter({ format: "online" }, undefined)).toBe("table_size");
    expect(missingFilter({ format: "online", table_size: 6 }, undefined)).toBe("stake");
    expect(missingFilter({ format: "online", table_size: 6, stake: "s" }, undefined)).toBe("depth");
    // All four set but resolving to no configuration: the depth is the filter to choose again.
    expect(missingFilter({ format: "online", table_size: 6, stake: "s", depth: 1 }, undefined)).toBe("depth");
    const withoutPair = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10000 } as const;
    expect(missingFilter(withoutPair, FIXTURE_STUDY_CONFIG_ID)).toBe("pair");
    expect(missingFilter(FULL, FIXTURE_STUDY_CONFIG_ID)).toBeNull();
    expect(FILTER_PROMPTS.pair).toMatch(/pair/i);
  });
});

describe("R3.12 study search updates", () => {
  it("R3.12 a format, table size or stake change clears every filter below it, the line and the hand", () => {
    expect(withFilter(FULL, "format", "live")).toEqual({ format: "live", mode: "ev" });
    expect(withFilter(FULL, "table_size", "9")).toEqual({ format: "online", table_size: 9, mode: "ev" });
    expect(withFilter(FULL, "stake", "other")).toEqual({ format: "online", table_size: 6, stake: "other", mode: "ev" });
  });

  it("R3.12 a depth change keeps the pair and clears the line and the hand", () => {
    expect(withFilter(FULL, "depth", "20000")).toEqual({
      format: "online",
      table_size: 6,
      stake: FIXTURE_ONLINE_STAKE_ID,
      depth: 20000,
      pair: "BB-BTN",
      mode: "ev",
    });
  });

  it("R3.12 a pair change clears the line and the hand; an empty value clears the filter", () => {
    expect(withFilter(FULL, "pair", "SB-BTN")).toMatchObject({ pair: "SB-BTN" });
    expect(withFilter(FULL, "pair", "SB-BTN")).not.toHaveProperty("line");
    expect(withFilter(FULL, "pair", "")).not.toHaveProperty("pair");
  });

  it("R3.12 line, mode and hand updates touch only their own parameter", () => {
    expect(withLine(FULL, "r250.r1100")).toEqual({ ...FULL, line: "r250.r1100" });
    expect(withLine(FULL, "")).not.toHaveProperty("line");
    expect(withMode(FULL, "weight")).toEqual({ ...FULL, mode: "weight" });
    expect(withHand(FULL, "QQ")).toEqual({ ...FULL, hand: "QQ" });
  });
});
