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
  confirmBlocker,
  draftConfigId,
  draftUncoveredPair,
  fieldStates,
  draftFromSearch,
  draftPair,
  searchFromDraft,
  settingChoices,
  settingsSummary,
  stakeRakeText,
  withSetting,
  type SettingChoice,
  type SettingsCatalog,
  type SettingKey,
  type SettingsDraft,
} from "../../src/study/settings.js";

const LIVE_25_STAKE_ID = "00000000-0000-4000-8000-0000000000a3";

/** The fixture catalog, with every configuration's pairs loaded. */
const CATALOG: SettingsCatalog = {
  stakes: fixtureStakes,
  configs: fixtureConfigs,
  pairsOf: (configId) => fixturePairsByConfig[configId],
};

function summary(choices: readonly SettingChoice[] | undefined) {
  return (choices ?? []).map(({ value, disabled, reason }) => ({ value, disabled, reason }));
}

const ONLINE_100: SettingsDraft = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10000 };

describe("R3.12 study settings choices", () => {
  it("R3.12 each field waits for the fields above it", () => {
    const choices = settingChoices(CATALOG, {});
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
    const catalog: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs.filter((config) => config.format === "online"), pairsOf: () => undefined };
    expect(summary(settingChoices(catalog, {}).format)[1]).toEqual({ value: "live", disabled: true, reason: "Not in the catalog" });
  });

  it("R3.12 table sizes span both formats; a size the format lacks is disabled with the reason", () => {
    const choices = settingChoices(CATALOG, { format: "live" });
    expect(summary(choices.table_size)).toEqual([
      { value: "6", disabled: true, reason: "No live game at this size" },
      { value: "9", disabled: false, reason: undefined },
    ]);
    expect(choices.table_size?.map((choice) => choice.label)).toEqual(["6 players", "9 players"]);
  });

  it("R3.12 stakes are the format's, each with its rake, and one without a game at the size is disabled", () => {
    const draft: SettingsDraft = { format: "live", table_size: 9 };
    const stakes = settingChoices(CATALOG, draft).stake;
    expect(summary(stakes)).toEqual([
      { value: FIXTURE_LIVE_STAKE_ID, disabled: false, reason: undefined },
      { value: LIVE_25_STAKE_ID, disabled: true, reason: "No 9-player game at this stake" },
    ]);
    expect(stakes?.[0]).toMatchObject({ label: "1/3", detail: "10% rake, cap $5.00, no flop no drop" });
  });

  it("R3.12 depths span the format; one missing at this stake and size is disabled", () => {
    const draft: SettingsDraft = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID };
    const depths = settingChoices(CATALOG, draft).depth;
    expect(depths?.map((choice) => choice.label)).toEqual(["100bb", "200bb"]);
    expect(depths?.every((choice) => !choice.disabled)).toBe(true);

    // A 150 bb game exists only at 9 players, so at 6 players that depth is listed but disabled.
    const nine = { ...fixtureConfigs[0]!, config_id: "cfg_9_online_150", table_size: 9, depth_cbb: 15000 };
    const wider: SettingsCatalog = { ...CATALOG, configs: [...fixtureConfigs, nine] };
    expect(summary(settingChoices(wider, draft).depth)).toEqual([
      { value: "10000", disabled: false, reason: undefined },
      { value: "15000", disabled: true, reason: "Not at this stake and size" },
      { value: "20000", disabled: false, reason: undefined },
    ]);
  });

  it("R3.12 a field below an unavailable choice waits and names that field", () => {
    const live: SettingsDraft = { format: "live", table_size: 6, stake: FIXTURE_LIVE_STAKE_ID };
    expect(settingChoices(CATALOG, live).depth).toBeUndefined();
    expect(fieldStates(CATALOG, live).depth).toEqual({ kind: "waiting", cause: "upper", reason: "Choose an available table size first." });
  });

  it("R3.12 first to act lists the seats in action order but the last; a seat with no covered pair is disabled", () => {
    const choices = settingChoices(CATALOG, ONLINE_100);
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
    const btn: SettingsDraft = { ...ONLINE_100, first: "BTN" };
    expect(summary(settingChoices(CATALOG, btn).against)).toEqual([
      { value: "SB", disabled: false, reason: undefined },
      { value: "BB", disabled: false, reason: undefined },
    ]);
    // With SB-BTN not covered, BTN still has a covered pair (BB-BTN), so SB is listed but disabled.
    const partial: SettingsCatalog = {
      ...CATALOG,
      pairsOf: () => [
        { pair: "BB-BTN", oop: "BB", ip: "BTN", preflop_available: true },
        { pair: "SB-BTN", oop: "SB", ip: "BTN", preflop_available: false },
      ],
    };
    expect(summary(settingChoices(partial, btn).against)).toEqual([
      { value: "SB", disabled: true, reason: "Not in the library" },
      { value: "BB", disabled: false, reason: undefined },
    ]);
  });

  it("R3.12 against waits, naming the seat, when the first seat chosen is unavailable", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "CO" };
    expect(settingChoices(CATALOG, draft).against).toBeUndefined();
    expect(fieldStates(CATALOG, draft).against).toMatchObject({ kind: "waiting", reason: "Choose an available seat to act first." });
  });
});

describe("R3.12 study settings changes", () => {
  it("R3.12 a change keeps every lower choice that is still available", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "BB" };
    const deeper = withSetting(CATALOG, draft, "depth", "20000");
    expect(deeper).toEqual({ ...draft, depth: 20000 });
  });

  it("R3.12 a change drops the lower choices that became unavailable", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "BB" };
    expect(withSetting(CATALOG, draft, "format", "live")).toEqual({ format: "live" });
    const live: SettingsDraft = { format: "live", table_size: 9, stake: FIXTURE_LIVE_STAKE_ID, depth: 10000 };
    expect(withSetting(CATALOG, live, "table_size", "6")).toEqual({ format: "live", table_size: 6 });
  });

  it("R3.12 seats wait while the pairs load and are checked once they arrive", () => {
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "SB" };
    const loading: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs, pairsOf: () => undefined };
    expect(withSetting(loading, draft, "depth", "20000")).toEqual({ ...draft, depth: 20000 });
    const deep: SettingsDraft = { ...draft, depth: 20000 };
    expect(canConfirm(CATALOG, deep)).toBe(false);
  });

  it("R3.12 a malformed value is ignored", () => {
    const draft: SettingsDraft = { format: "online" };
    expect(withSetting(CATALOG, draft, "table_size", "six")).toEqual(draft);
    expect(withSetting(CATALOG, draft, "format", "home")).toEqual(draft);
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
    expect(canConfirm(CATALOG, full)).toBe(true);
    expect(canConfirm(CATALOG, ONLINE_100)).toBe(false);
    const uncovered: SettingsDraft = { ...ONLINE_100, first: "CO", against: "BTN" };
    expect(canConfirm(CATALOG, uncovered)).toBe(false);
    expect(draftConfigId(fixtureConfigs, { ...ONLINE_100, depth: 20000 })).toBe(FIXTURE_DEEP_CONFIG_ID);
  });
});

describe("R3.12 why Confirm is unavailable", () => {
  it("R3.12 the reason names what is missing, loading or unavailable", () => {
    expect(confirmBlocker(undefined, {})).toBe("Loading the catalog.");
    expect(confirmBlocker(CATALOG, {})).toBe("Choose the format.");
    expect(confirmBlocker(CATALOG, { format: "online" })).toBe("Choose the table size.");
    expect(confirmBlocker(CATALOG, ONLINE_100)).toBe("Choose who acts first.");
    expect(confirmBlocker(CATALOG, { ...ONLINE_100, first: "BTN" })).toBe("Choose the opponent.");
    expect(confirmBlocker(CATALOG, { ...ONLINE_100, first: "CO", against: "BTN" })).toBe(
      "First to act: CO is unavailable (not in the library).",
    );
    const live: SettingsDraft = { format: "live", table_size: 9, stake: LIVE_25_STAKE_ID };
    expect(confirmBlocker(CATALOG, live)).toBe("Stake: 2/5 is unavailable (no 9-player game at this stake).");
    expect(confirmBlocker(CATALOG, { ...ONLINE_100, first: "BTN", against: "BB" })).toBeUndefined();
  });

  it("R3.12 seats waiting on their configuration's pairs say they are loading", () => {
    const loading: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs, pairsOf: () => undefined };
    expect(confirmBlocker(loading, { ...ONLINE_100, first: "BTN", against: "BB" })).toBe("Loading the seats for these settings.");
    expect(confirmBlocker(loading, ONLINE_100)).toBe("Loading the seats for these settings.");
  });

  it("R3.12 seats whose read failed say they could not be loaded, not that they are loading", () => {
    const failed: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs, pairsOf: () => undefined };
    const draft: SettingsDraft = { ...ONLINE_100, first: "BTN", against: "BB" };
    expect(confirmBlocker(failed, draft, { seatsFailed: true })).toBe("The seats for these settings could not be loaded.");
    expect(confirmBlocker(failed, draft, { seatsFailed: false })).toBe("Loading the seats for these settings.");
    expect(canConfirm(failed, draft, { seatsFailed: true })).toBe(false);
  });

  it("R3.12 a waiting field names the first upper field missing or unavailable, or says loading or failed", () => {
    const loading: SettingsCatalog = { stakes: fixtureStakes, configs: fixtureConfigs, pairsOf: () => undefined };
    const reason = (catalog: SettingsCatalog | undefined, draft: SettingsDraft, key: SettingKey, seatsFailed = false) => {
      const state = fieldStates(catalog, draft, { seatsFailed })[key];
      return state.kind === "waiting" ? state.reason : "choices";
    };
    expect(reason(CATALOG, {}, "table_size")).toBe("Choose a format first.");
    expect(reason(CATALOG, { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID }, "first")).toBe("Choose a depth first.");
    expect(reason(loading, ONLINE_100, "first")).toBe("Loading the seats for these settings.");
    expect(reason(loading, ONLINE_100, "first", true)).toBe("The seats for these settings could not be loaded.");
    expect(reason(CATALOG, { ...ONLINE_100, depth: 30000 }, "first")).toBe("Choose an available depth first.");
    expect(reason(undefined, {}, "format")).toBe("Loading the catalog.");
    expect(reason(undefined, {}, "table_size")).toBe("Choose a format first.");
    expect(reason(CATALOG, { ...ONLINE_100, first: "CO" }, "against")).toBe("Choose an available seat to act first.");
  });

  it("R3.12 seats below a missing stake ask for the stake, and Confirm names it too", () => {
    const noStake: SettingsDraft = { format: "online", table_size: 6, depth: 10000, first: "BTN", against: "BB" };
    const states = fieldStates(CATALOG, noStake);
    expect(states.depth).toMatchObject({ kind: "waiting", reason: "Choose a stake first." });
    expect(states.first).toMatchObject({ kind: "waiting", reason: "Choose a stake first." });
    expect(states.against).toMatchObject({ kind: "waiting", reason: "Choose a stake first." });
    expect(confirmBlocker(CATALOG, noStake)).toBe("Choose the stake.");
  });

  it("R3.12 seats below a stake of the other format name the stake, not the depth", () => {
    const otherFormat: SettingsDraft = { ...ONLINE_100, stake: FIXTURE_LIVE_STAKE_ID, first: "BTN", against: "BB" };
    const states = fieldStates(CATALOG, otherFormat);
    expect(states.first).toMatchObject({ kind: "waiting", reason: "Choose an available stake first." });
    expect(states.against).toMatchObject({ kind: "waiting", reason: "Choose an available stake first." });
    expect(confirmBlocker(CATALOG, otherFormat)).toBe("Choose the stake.");
  });

  it("R3.12 the uncovered pair the draft names, if any", () => {
    expect(draftUncoveredPair(CATALOG, { ...ONLINE_100, first: "CO", against: "BTN" })).toBe("CO-BTN");
    expect(draftUncoveredPair(CATALOG, { ...ONLINE_100, first: "BTN", against: "BB" })).toBeUndefined();
    expect(draftUncoveredPair(CATALOG, { ...ONLINE_100, first: "CO" })).toBeUndefined();
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
