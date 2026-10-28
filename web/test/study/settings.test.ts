// Tests for the study settings panel's pure rules (S39, R3.12, O-354, O-390, O-392): the choices
// each field offers, which are disabled and why, how a change keeps or drops the choices below it,
// how two seats name a catalog pair, when Confirm is allowed, the search Confirm writes and the
// stake's rake text.
import { describe, expect, it } from "vitest";

import {
  FIXTURE_DEEP_CONFIG_ID,
  FIXTURE_LIVE_STAKE_ID,
  FIXTURE_ONLINE_STAKE_ID,
  FIXTURE_STUDY_CONFIG_ID,
  fixtureConfigs,
  fixturePairsByConfig,
  fixtureStakes,
} from "../../src/fixtures/study.js";
import { formatBasisPoints, formatCents } from "../../src/poker/format.js";
import {
  canConfirm,
  draftConfigId,
  draftFromSearch,
  draftPair,
  searchFromDraft,
  settingChoices,
  settingsSummary,
  stakeRakeText,
  withSetting,
  type SettingChoice,
  type SettingsCatalog,
  type SettingsDraft,
} from "../../src/study/settings.js";

const LIVE_25_STAKE_ID = "00000000-0000-4000-8000-0000000000a3";

function catalogFor(draft: SettingsDraft): SettingsCatalog {
  const configId = draftConfigId(fixtureConfigs, draft);
  return {
    stakes: fixtureStakes,
    configs: fixtureConfigs,
    pairs: configId === undefined ? undefined : fixturePairsByConfig[configId],
  };
}

function summary(choices: readonly SettingChoice[] | undefined) {
  return (choices ?? []).map(({ value, disabled, reason }) => ({ value, disabled, reason }));
}

const ONLINE_100: SettingsDraft = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10000 };

describe("R3.12 study settings choices", () => {
  it("R3.12 each field waits for the fields above it", () => {
    const choices = settingChoices(catalogFor({}), {});
    expect(summary(choices.format)).toEqual([
      { value: "online", disabled: false, reason: undefined },
      { value: "live", disabled: false, reason: undefined },
    ]);
    expect(choices.table_size).toBeUndefined();
    expect(choices.stake).toBeUndefined();
    expect(choices.depth).toBeUndefined();
    expect(choices.first).toBeUndefined();
    expect(choices.against).toBeUndefined();
  });

  it("R3.12 a format with no configuration is disabled as not in the catalog", () => {
    const catalog: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs.filter((config) => config.format === "online"), pairs: undefined };
    expect(summary(settingChoices(catalog, {}).format)[1]).toEqual({ value: "live", disabled: true, reason: "Not in the catalog" });
  });

  it("R3.12 table sizes span both formats; a size the format lacks is disabled with the reason", () => {
    const choices = settingChoices(catalogFor({ format: "live" }), { format: "live" });
    expect(summary(choices.table_size)).toEqual([
      { value: "6", disabled: true, reason: "No live game at this size" },
      { value: "9", disabled: false, reason: undefined },
    ]);
    expect(choices.table_size?.map((choice) => choice.label)).toEqual(["6 players", "9 players"]);
  });

  it("R3.12 stakes are the format's, each with its rake, and one without a game at the size is disabled", () => {
    const draft: SettingsDraft = { format: "live", table_size: 9 };
    const stakes = settingChoices(catalogFor(draft), draft).stake;
    expect(summary(stakes)).toEqual([
      { value: FIXTURE_LIVE_STAKE_ID, disabled: false, reason: undefined },
      { value: LIVE_25_STAKE_ID, disabled: true, reason: "No 9-player game at this stake" },
    ]);
    expect(stakes?.[0]).toMatchObject({ label: "1/3", detail: "10% rake, cap $5.00, no flop no drop" });
  });

  it("R3.12 depths span the format; one missing at this stake and size is disabled", () => {
    const draft: SettingsDraft = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID };
    const depths = settingChoices(catalogFor(draft), draft).depth;
    expect(depths?.map((choice) => choice.label)).toEqual(["100bb", "200bb"]);
    expect(depths?.every((choice) => !choice.disabled)).toBe(true);

    const live: SettingsDraft = { format: "live", table_size: 6, stake: FIXTURE_LIVE_STAKE_ID };
    expect(summary(settingChoices(catalogFor(live), live).depth)).toEqual([
      { value: "10000", disabled: true, reason: "Not at this stake and size" },
    ]);
  });

  it("R3.12 first to act lists the seats in action order but the last; a seat with no covered pair is disabled", () => {
    const choices = settingChoices(catalogFor(ONLINE_100), ONLINE_100);
    expect(summary(choices.first)).toEqual([
      { value: "UTG", disabled: true, reason: "Not in the library" },
      { value: "HJ", disabled: true, reason: "Not in the library" },
      { value: "CO", disabled: true, reason: "Not in the library" },
      { value: "BTN", disabled: false, reason: undefined },
      { value: "SB", disabled: true, reason: "Not in the library" },
    ]);
    expect(choices.against).toBeUndefined();
  });

  it("R3.12 against lists the seats after the first; an uncovered pair is disabled", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "CO" };
    expect(summary(settingChoices(catalogFor(draft), draft).against)).toEqual([
      { value: "BTN", disabled: true, reason: "Not in the library" },
      { value: "SB", disabled: true, reason: "Not in the library" },
      { value: "BB", disabled: true, reason: "Not in the library" },
    ]);
    const btn: SettingsDraft = { ...ONLINE_100, first: "BTN" };
    expect(summary(settingChoices(catalogFor(btn), btn).against)).toEqual([
      { value: "SB", disabled: false, reason: undefined },
      { value: "BB", disabled: false, reason: undefined },
    ]);
  });
});

describe("R3.12 study settings changes", () => {
  it("R3.12 a change keeps every lower choice that is still available", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "BB" };
    const deeper = withSetting(catalogFor(draft), draft, "depth", "20000");
    expect(deeper).toEqual({ ...draft, depth: 20000 });
  });

  it("R3.12 a change drops the lower choices that became unavailable", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "BB" };
    expect(withSetting(catalogFor(draft), draft, "format", "live")).toEqual({ format: "live" });
    const live: SettingsDraft = { format: "live", table_size: 9, stake: FIXTURE_LIVE_STAKE_ID, depth: 10000 };
    expect(withSetting(catalogFor(live), live, "table_size", "6")).toEqual({ format: "live", table_size: 6 });
  });

  it("R3.12 seats wait while the pairs load and are checked once they arrive", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "SB" };
    const loading: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs, pairs: undefined };
    expect(withSetting(loading, draft, "depth", "20000")).toEqual({ ...draft, depth: 20000 });
    const deep: SettingsDraft = { ...draft, depth: 20000 };
    expect(canConfirm(catalogFor(deep), deep)).toBe(false);
  });

  it("R3.12 a malformed value is ignored", () => {
    const draft: SettingsDraft = { format: "online" };
    expect(withSetting(catalogFor(draft), draft, "table_size", "six")).toEqual(draft);
    expect(withSetting(catalogFor(draft), draft, "format", "home")).toEqual(draft);
  });

  it("R3.12 two seats name the catalog pair in either order", () => {
    const pairs = fixturePairsByConfig[FIXTURE_STUDY_CONFIG_ID];
    expect(draftPair(pairs, { first: "BTN", against: "BB" })?.pair).toBe("BB-BTN");
    expect(draftPair(pairs, { first: "UTG", against: "HJ" })?.pair).toBe("UTG-HJ");
    expect(draftPair(pairs, { first: "UTG", against: "BB" })).toBeUndefined();
    expect(draftPair(undefined, { first: "BTN", against: "BB" })).toBeUndefined();
  });

  it("R3.12 Confirm needs all six choices, each available", () => {
    const full: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "BB" };
    expect(canConfirm(catalogFor(full), full)).toBe(true);
    expect(canConfirm(catalogFor(ONLINE_100), ONLINE_100)).toBe(false);
    const uncovered: SettingsDraft = { ...ONLINE_100, first: "CO", against: "BTN" };
    expect(canConfirm(catalogFor(uncovered), uncovered)).toBe(false);
    expect(draftConfigId(fixtureConfigs, { ...ONLINE_100, depth: 20000 })).toBe(FIXTURE_DEEP_CONFIG_ID);
  });
});

describe("R3.12 study settings and the URL", () => {
  it("R3.12 the draft starts from the URL, the pair split into its seats in action order", () => {
    expect(draftFromSearch({ ...ONLINE_100, pair: "BB-BTN", line: "r250", hand: "AKs" })).toEqual({
      ...ONLINE_100,
      first: "BTN",
      against: "BB",
    });
    expect(draftFromSearch({ format: "online", pair: "SB-BB" })).toEqual({ format: "online", first: "SB", against: "BB" });
    expect(draftFromSearch({})).toEqual({});
  });

  it("R3.12 Confirm with changed settings clears the line and the hand and keeps the mode", () => {
    const search = { ...ONLINE_100, pair: "BB-BTN", line: "r250", hand: "AKs", mode: "ev" as const };
    expect(searchFromDraft(search, { ...ONLINE_100, depth: 20000, first: "BTN", against: "BB" }, "BB-BTN")).toEqual({
      ...ONLINE_100,
      depth: 20000,
      pair: "BB-BTN",
      mode: "ev",
    });
  });

  it("R3.12 Confirm with unchanged settings keeps the line and the hand", () => {
    const search = { ...ONLINE_100, pair: "BB-BTN", line: "r250", hand: "AKs" };
    expect(searchFromDraft(search, { ...ONLINE_100, first: "BTN", against: "BB" }, "BB-BTN")).toEqual(search);
  });

  it("R3.12 the summary names every setting, the stake with its rake", () => {
    expect(settingsSummary(fixtureStakes, { ...ONLINE_100, pair: "BB-BTN" })).toBe(
      "Online, 6 players, online (5% rake, cap $1.50), 100bb, BTN against BB",
    );
  });
});

describe("R3.12 rake display", () => {
  it("R3.12 basis points print as a percent and cents as dollars, display only", () => {
    expect(formatBasisPoints(500)).toBe("5%");
    expect(formatBasisPoints(450)).toBe("4.5%");
    expect(formatCents(150)).toBe("$1.50");
    expect(formatCents(500)).toBe("$5.00");
    expect(stakeRakeText(fixtureStakes[0]!)).toBe("5% rake, cap $1.50");
  });
});
