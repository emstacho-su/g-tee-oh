/**
 * The builder's pure draft model and client validation (S26, R3.14, O-311, O-317): the default
 * new drill, a drill to a draft and back without loss, the edits the form makes, and the write
 * rules that mirror SpotFilterWrite and the field limits of services/api/src/schemas/drills.ts.
 */
import { describe, expect, it } from "vitest";

import { checkDrillBody } from "../../src/drills/body-rules.js";
import { copyName, draftFromDrill, draftToCreate, draftToPatch, newDrillDraft, type DrillDraft } from "../../src/drills/draft.js";
import { deepEqual, draftsEqual } from "../../src/drills/draft-compare.js";
import { toggleHand, toggleHero, togglePanel, toggleVillain, withFormat, withTableSize } from "../../src/drills/draft-edits.js";
import { fieldKeyOf, groupFieldErrors } from "../../src/drills/field-errors.js";
import { MAX_DRILL_NAME_LENGTH } from "../../src/drills/limits.js";
import type { Drill, DrillCreate } from "../../src/drills/types.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";

function rfiDraft(): DrillDraft {
  return { ...toggleHero(newDrillDraft(), "BTN"), name: "RFI boundary hands", handsMode: "close_decisions" };
}

function created(draft: DrillDraft): DrillCreate {
  const result = draftToCreate(draft);
  if (!result.ok) throw new Error(`expected a valid draft, got ${JSON.stringify(result.errors)}`);
  return result.body;
}

function errorPaths(draft: DrillDraft): string[] {
  const result = draftToCreate(draft);
  return result.ok ? [] : result.errors.map((error) => error.path);
}

const RICH_DRILL: Drill = {
  ...fixtureDrill,
  id: "00000000-0000-4000-8000-0000000000d1",
  name: "Live 9-handed, every field",
  tags: ["live", "deep"],
  spot_filter: {
    game_config: { format: "live", table_size: 9, depths_bb: [100, 150] },
    stake: "2/5",
    sizing: { mode: "fixed", open_bb: 3, three_bet_bb: 10 },
    start_street: "flop",
    hero_positions: ["CO", "BTN"],
    villain_positions: ["BB"],
    preflop_action: ["srp", "three_bet"],
    line: "r300.c",
    board: { high_card: "K", paired: false, suits: "rainbow", connectivity: "gapped", flops: ["Kh8d3c"] },
    hands: { mode: "manual", hands: ["AKs", "77", "T9o"] },
    alternate_seats: true,
  },
  trainer: {
    stop_rule: "end_of_hand",
    input: "frequency",
    grouping: "simple",
    rng: true,
    pause: "never",
    speed: "fast",
    quick_result: true,
    tables: 2,
    timebank_s: 15,
    panels: { hero_range_matrix: true, streak_counter: false },
  },
};

describe("R3.14 drill draft model", () => {
  it("R3.14 the new drill default is online 6-handed at 100 bb, preflop RFI, every hand, stop after the spot", () => {
    const draft = newDrillDraft();
    expect(draft).toMatchObject({ format: "online", tableSize: 6, depthsText: "100", stake: "online", startStreet: "preflop" });
    expect(draft.preflopAction).toEqual(["rfi"]);
    expect(draft.handsMode).toBe("all");
    expect(draft.trainer).toMatchObject({ stop_rule: "after_action", input: "actions", tables: 1, timebank_s: null, rng: false });
    expect(errorPaths(draft)).toEqual(["name", "spot_filter.hero_positions"]);
  });

  it("R3.14 the RFI boundary hands draft becomes the DrillCreate body flow 2 saves", () => {
    expect(created({ ...rfiDraft(), tagsText: "rfi, boundary" })).toEqual({
      name: "RFI boundary hands",
      tags: ["rfi", "boundary"],
      spot_filter: {
        game_config: { format: "online", table_size: 6, depths_bb: [100] },
        stake: "online",
        sizing: { mode: "convention" },
        start_street: "preflop",
        hero_positions: ["BTN"],
        villain_positions: [],
        preflop_action: ["rfi"],
        hands: { mode: "close_decisions" },
        alternate_seats: false,
      },
      trainer: newDrillDraft().trainer,
    });
  });

  it.each([fixtureDrill, RICH_DRILL])("R3.14 a drill becomes a draft and back without losing a field (%#)", (drill) => {
    const { name, tags, spot_filter, trainer } = drill;
    expect(created(draftFromDrill(drill))).toEqual({ name, tags, spot_filter, trainer });
  });

  it("R3.14 a patch carries only the fields the draft changed, and nothing when nothing changed", () => {
    const unchanged = draftToPatch(draftFromDrill(RICH_DRILL), RICH_DRILL);
    expect(unchanged).toEqual({ ok: true, body: {} });
    const renamed = draftToPatch({ ...draftFromDrill(RICH_DRILL), name: "  Renamed  " }, RICH_DRILL);
    expect(renamed).toEqual({ ok: true, body: { name: "Renamed" } });
    const retimed = draftToPatch({ ...draftFromDrill(RICH_DRILL), trainer: { ...RICH_DRILL.trainer, timebank_s: null } }, RICH_DRILL);
    expect(retimed.ok && Object.keys(retimed.body)).toEqual(["trainer"]);
    const invalid = draftToPatch({ ...draftFromDrill(RICH_DRILL), name: "" }, RICH_DRILL);
    expect(invalid.ok).toBe(false);
  });

  it("R3.14 O-311 a duplicate's name gains (copy) and is trimmed to the 120-character limit", () => {
    expect(copyName("RFI boundary hands")).toBe("RFI boundary hands (copy)");
    const long = "x".repeat(MAX_DRILL_NAME_LENGTH);
    expect(copyName(long)).toHaveLength(MAX_DRILL_NAME_LENGTH);
    expect(copyName(long).endsWith(" (copy)")).toBe(true);
  });

  it("R3.14 edits: format resets the stake, table size drops unseated seats, a hero leaves the villains", () => {
    const live = withFormat(newDrillDraft(), "live");
    expect(live.stake).toBe("");
    expect(withFormat({ ...live, stake: "2/5" }, "online").stake).toBe("online");
    expect(withFormat({ ...live, stake: "2/5" }, "live").stake).toBe("2/5");
    const nine = toggleVillain(toggleHero(withTableSize(newDrillDraft(), 9), "LJ"), "UTG2");
    expect(withTableSize(nine, 6)).toMatchObject({ tableSize: 6, heroPositions: [], villainPositions: [] });
    const both = toggleHero(toggleVillain(newDrillDraft(), "BTN"), "BTN");
    expect(both).toMatchObject({ heroPositions: ["BTN"], villainPositions: [] });
    expect(toggleHero(both, "BTN").heroPositions).toEqual([]);
    expect(toggleHero(toggleHero(newDrillDraft(), "BB"), "UTG").heroPositions).toEqual(["UTG", "BB"]);
  });

  it("R3.14 edits: hands and panels toggle on and off, leaving the input draft unchanged", () => {
    const draft = newDrillDraft();
    const picked = toggleHand(toggleHand(draft, "AKs"), "77");
    expect(picked.manualHands).toEqual(["AKs", "77"]);
    expect(toggleHand(picked, "AKs").manualHands).toEqual(["77"]);
    expect(draft.manualHands).toEqual([]);
    expect(togglePanel(draft, "rng_roller").trainer.panels).toEqual({ rng_roller: true });
    expect(togglePanel(togglePanel(draft, "rng_roller"), "rng_roller").trainer.panels).toEqual({ rng_roller: false });
  });
});

describe("R3.14 client validation mirrors SpotFilterWrite and the field limits", () => {
  it("R3.14 name, tags and depths are checked against their limits", () => {
    const base = rfiDraft();
    expect(errorPaths({ ...base, name: "   " })).toEqual(["name"]);
    expect(errorPaths({ ...base, name: "x".repeat(MAX_DRILL_NAME_LENGTH + 1) })).toEqual(["name"]);
    expect(errorPaths({ ...base, tagsText: "ok Bad-Tag" })).toEqual(["tags.1"]);
    expect(errorPaths({ ...base, tagsText: Array.from({ length: 21 }, (_, index) => `t${index}`).join(" ") })).toEqual(["tags"]);
    expect(errorPaths({ ...base, depthsText: "" })).toEqual(["spot_filter.game_config.depths_bb"]);
    expect(errorPaths({ ...base, depthsText: "100 abc" })).toEqual(["spot_filter.game_config.depths_bb"]);
    expect(errorPaths({ ...base, depthsText: "100 100" })).toEqual(["spot_filter.game_config.depths_bb.1"]);
    expect(errorPaths({ ...base, depthsText: "0 1001" })).toEqual(["spot_filter.game_config.depths_bb.0", "spot_filter.game_config.depths_bb.1"]);
    expect(errorPaths({ ...base, depthsText: "1 2 3 4 5 6 7 8 9" })).toEqual(["spot_filter.game_config.depths_bb"]);
  });

  it("R3.14 the stake must match the format, and fixed sizes must be positive numbers", () => {
    const base = rfiDraft();
    expect(errorPaths({ ...base, stake: "1/3" })).toEqual(["spot_filter.stake"]);
    expect(errorPaths({ ...withFormat(base, "live"), stake: "online" })).toEqual(["spot_filter.stake"]);
    expect(errorPaths({ ...withFormat(base, "live"), stake: "" })).toEqual(["spot_filter.stake"]);
    expect(errorPaths({ ...withFormat(base, "live"), stake: "1/3" })).toEqual([]);
    expect(errorPaths({ ...base, sizingMode: "fixed", openBbText: "2.5", threeBetBbText: "" })).toEqual([]);
    expect(errorPaths({ ...base, sizingMode: "fixed", openBbText: "-1", threeBetBbText: "x" })).toEqual([
      "spot_filter.sizing.open_bb",
      "spot_filter.sizing.three_bet_bb",
    ]);
  });

  it("R3.14 seats must be seated at the table size and disjoint; actions, line, flops and hands are checked", () => {
    const base = rfiDraft();
    expect(errorPaths({ ...base, heroPositions: [] })).toEqual(["spot_filter.hero_positions"]);
    expect(errorPaths({ ...base, heroPositions: ["LJ"] })).toEqual(["spot_filter.hero_positions.0"]);
    expect(errorPaths({ ...base, villainPositions: ["BTN"] })).toEqual(["spot_filter.villain_positions.0"]);
    expect(errorPaths({ ...base, preflopAction: [] })).toEqual(["spot_filter.preflop_action"]);
    expect(errorPaths({ ...base, lineText: "r250..c" })).toEqual(["spot_filter.line"]);
    expect(errorPaths({ ...base, board: { ...base.board, flopsText: "Kh8d3c KK" } })).toEqual(["spot_filter.board.flops.1"]);
    expect(errorPaths({ ...base, handsMode: "manual" })).toEqual(["spot_filter.hands.hands"]);
    expect(errorPaths({ ...base, handsMode: "manual", manualHands: ["AKs"] })).toEqual([]);
  });

  it("R3.14 body rules catch what a typed body can still get wrong (the mocked api uses them too)", () => {
    const body = created(rfiDraft());
    const broken: DrillCreate = {
      ...body,
      spot_filter: {
        ...body.spot_filter,
        game_config: { ...body.spot_filter.game_config, table_size: 10 },
        hero_positions: ["BTN", "BTN"],
        preflop_action: ["rfi", "rfi"],
        hands: { mode: "manual", hands: ["AKs", "AKs", "XYz"] },
      },
      trainer: { ...body.trainer, tables: 5 },
    };
    expect(checkDrillBody(broken).map((error) => error.path)).toEqual([
      "spot_filter.game_config.table_size",
      "spot_filter.hero_positions.0",
      "spot_filter.hero_positions.1",
      "spot_filter.hero_positions.1",
      "spot_filter.preflop_action.1",
      "spot_filter.hands.hands.1",
      "spot_filter.hands.hands.2",
      "trainer.tables",
    ]);
  });

  it("R3.14 server field errors land on the field they name, and unknown paths on the form", () => {
    expect(fieldKeyOf("body.spot_filter.hero_positions.0")).toBe("spot_filter.hero_positions");
    expect(fieldKeyOf("body.name")).toBe("name");
    expect(fieldKeyOf("spot_filter.game_config.depths_bb.2")).toBe("spot_filter.game_config.depths_bb");
    expect(fieldKeyOf("body.trainer.panels.rng_roller")).toBe("trainer.panels");
    expect(fieldKeyOf("body")).toBe("form");
    expect(fieldKeyOf("querystring.cursor")).toBe("form");
    const grouped = groupFieldErrors([
      { path: "body.spot_filter.stake", message: "a live drill needs a live stake such as 1/3" },
      { path: "body.spot_filter.stake", message: "too long" },
      { path: "body.unknown_key", message: "unrecognized key" },
    ]);
    expect(grouped).toEqual({
      "spot_filter.stake": ["a live drill needs a live stake such as 1/3", "too long"],
      form: ["unrecognized key"],
    });
  });
});

describe("R3.14 draftsEqual compares drafts by meaning (PR #42 review round 1, F)", () => {
  it("R3.14 key order does not matter, values do", () => {
    const draft = newDrillDraft();
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as unknown as DrillDraft;
    expect(draftsEqual(draft, reordered)).toBe(true);
    expect(draftsEqual(draft, { ...draft, name: "x" })).toBe(false);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("R3.14 a panel turned on and off again equals the untouched draft", () => {
    const draft = newDrillDraft();
    expect(draftsEqual(draft, togglePanel(togglePanel(draft, "range_advantage"), "range_advantage"))).toBe(true);
    expect(draftsEqual(draft, togglePanel(draft, "range_advantage"))).toBe(false);
  });
});
