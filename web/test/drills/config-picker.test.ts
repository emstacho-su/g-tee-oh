/**
 * The builder's configuration picker model (S47, R3.37, design rule 8): the game page offers the
 * catalog's formats, table sizes, stakes and depths with Study's own reasons for what is
 * unavailable (settings-fields.ts, reused and never edited), the stake is offered by its id and
 * stored by its label as a drill stores it, and picked depths write depths_bb in order.
 */
import { describe, expect, it } from "vitest";

import { pickedDepths, pickerCatalog, pickerChoices, pickerDraft, withPickedStake, withPickedDepths } from "../../src/drills/config-picker-model.js";
import { newDrillDraft } from "../../src/drills/draft.js";
import { FIXTURE_LIVE_STAKE_ID, FIXTURE_ONLINE_STAKE_ID, fixtureConfigs, fixtureStakes } from "../../src/fixtures/study.js";

const catalog = pickerCatalog(fixtureStakes, fixtureConfigs);

describe("R3.37 the configuration picker model", () => {
  it("R3.37 the picker lists the catalog's formats, sizes, stakes and depths with Study's reasons", () => {
    const draft = newDrillDraft();
    const choices = pickerChoices(catalog, pickerDraft(draft, fixtureStakes));
    expect(choices.format.kind).toBe("choices");
    if (choices.format.kind !== "choices") throw new Error("no format choices");
    expect(choices.format.choices.map((choice) => [choice.value, choice.disabled])).toEqual([
      ["online", false],
      ["live", false],
    ]);
    if (choices.table_size.kind !== "choices") throw new Error("no size choices");
    expect(choices.table_size.choices.map((choice) => [choice.value, choice.disabled, choice.reason])).toEqual([
      ["6", false, undefined],
      ["9", true, "No online game at this size"],
    ]);
    if (choices.stake.kind !== "choices") throw new Error("no stake choices");
    expect(choices.stake.choices).toEqual([{ value: FIXTURE_ONLINE_STAKE_ID, label: "online", detail: "5% rake, cap $1.50", disabled: false }]);
    if (choices.depth.kind !== "choices") throw new Error("no depth choices");
    expect(choices.depth.choices.map((choice) => [choice.value, choice.label, choice.disabled])).toEqual([
      ["10000", "100 bb", false],
      ["20000", "200 bb", false],
    ]);
  });

  it("R3.37 the stake is offered by id and stored by label", () => {
    const draft = newDrillDraft();
    expect(pickerDraft(draft, fixtureStakes)).toEqual({ format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10_000 });
    const live = withPickedStake({ ...draft, format: "live", tableSize: 9 }, FIXTURE_LIVE_STAKE_ID, fixtureStakes);
    expect(live.stake).toBe("1/3");
    // A label the catalog does not list (an imported drill) has no id, so the stake field waits on the catalog.
    expect(pickerDraft({ ...draft, stake: "5/10", format: "live" }, fixtureStakes).stake).toBeUndefined();
    expect(withPickedStake(draft, "not-a-stake", fixtureStakes)).toBe(draft);
  });

  it("R3.37 a depth the stake lacks is disabled with its reason; picked depths write depths_bb in order", () => {
    const draft = { ...newDrillDraft(), format: "live" as const, tableSize: 9, stake: "1/3" };
    const choices = pickerChoices(catalog, pickerDraft(draft, fixtureStakes));
    if (choices.depth.kind !== "choices") throw new Error("no depth choices");
    expect(choices.depth.choices.map((choice) => [choice.value, choice.disabled])).toEqual([["10000", false]]);
    expect(pickedDepths({ ...draft, depthsText: "200, 100, abc" })).toEqual([200, 100]);
    expect(withPickedDepths(draft, [200, 100]).depthsText).toBe("100, 200");
    expect(withPickedDepths(draft, []).depthsText).toBe("");
    // A draft with several depths keeps the first one as the facet's single depth, so the stake and size facets still resolve.
    expect(pickerDraft({ ...draft, depthsText: "150, 100" }, fixtureStakes).depth).toBe(15_000);
  });

  it("R3.37 a draft outside the catalog leaves the lower facets waiting with Study's words", () => {
    const draft = { ...newDrillDraft(), format: "live" as const, tableSize: 7, stake: "1/3" };
    const choices = pickerChoices(catalog, pickerDraft(draft, fixtureStakes));
    expect(choices.stake).toEqual({ kind: "waiting", cause: "upper", reason: "Choose an available table size first." });
  });
});
