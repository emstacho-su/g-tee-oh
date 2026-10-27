/**
 * The drill schema in isolation (R3.14, O-235, ADR 0017). The schema is the only gate between a
 * request body and the jsonb columns, so each strict object must reject an unknown key, each
 * discriminated union must reject a missing mode, and the patch schema must reject an empty body.
 * Field names are g-tee-oh's own (schemas/drills.ts); this file only exercises them.
 */
import { describe, expect, it } from "vitest";

import {
  drillCreateBodySchema,
  drillPatchBodySchema,
  handsFilterSchema,
  sizingSchema,
  spotFilterSchema,
  tagSchema,
  trainerSettingsSchema,
  type DrillCreateBody,
} from "../src/schemas/drills.js";

const FULL_DRILL: DrillCreateBody = {
  name: "CO vs BTN three-bet pots",
  tags: ["three-bet", "co_btn"],
  spot_filter: {
    game_config: { format: "live", table_size: 9, depths_bb: [100, 150] },
    stake: "1/3",
    sizing: { mode: "fixed", open_bb: 4, three_bet_bb: 12 },
    start_street: "flop",
    hero_positions: ["CO"],
    villain_positions: ["BTN"],
    preflop_action: ["three_bet", "vs_three_bet"],
    line: "r400.r1200.c",
    board: { high_card: "K", paired: false, suits: "rainbow", connectivity: "disconnected", flops: ["Kh7d2c"] },
    hands: { mode: "manual", hands: ["AKs", "QQ", "T9o"] },
    alternate_seats: true,
  },
  trainer: {
    stop_rule: "end_of_hand",
    input: "frequency",
    grouping: "grouped",
    rng: true,
    pause: "every_action",
    speed: "fast",
    quick_result: true,
    tables: 2,
    timebank_s: 15,
    panels: { hero_range_matrix: true, rng_roller: false, streak_counter: true },
  },
};

const SPOT = FULL_DRILL.spot_filter;
const TRAINER = FULL_DRILL.trainer;

describe("R3.14 drill schema", () => {
  it("R3.14 a full valid drill body parses", () => {
    expect(drillCreateBodySchema.safeParse(FULL_DRILL).success).toBe(true);
  });

  it("R3.14 tags default to an empty list", () => {
    const withoutTags = Object.fromEntries(Object.entries(FULL_DRILL).filter(([key]) => key !== "tags"));
    expect(drillCreateBodySchema.parse(withoutTags).tags).toEqual([]);
  });

  it("R3.14 the create body rejects an unknown key", () => {
    expect(drillCreateBodySchema.safeParse({ ...FULL_DRILL, extra: 1 }).success).toBe(false);
  });

  it("R3.14 spot_filter rejects an unknown key", () => {
    expect(spotFilterSchema.safeParse({ ...SPOT, extra: true }).success).toBe(false);
  });

  it("R3.14 spot_filter.game_config rejects an unknown key", () => {
    const spot = { ...SPOT, game_config: { ...SPOT.game_config, extra: 1 } };
    expect(spotFilterSchema.safeParse(spot).success).toBe(false);
  });

  it("R3.14 spot_filter.board rejects an unknown key", () => {
    expect(spotFilterSchema.safeParse({ ...SPOT, board: { paired: true, extra: 1 } }).success).toBe(false);
  });

  it("R3.14 sizing and hands variants reject an unknown key", () => {
    expect(sizingSchema.safeParse({ mode: "convention", open_bb: 3 }).success).toBe(false);
    expect(handsFilterSchema.safeParse({ mode: "all", hands: ["AA"] }).success).toBe(false);
  });

  it("R3.14 trainer rejects an unknown key", () => {
    expect(trainerSettingsSchema.safeParse({ ...TRAINER, extra: 1 }).success).toBe(false);
  });

  it("R3.14 panels reject an unknown key", () => {
    const trainer = { ...TRAINER, panels: { hero_range_matrix: true, not_a_panel: true } };
    expect(trainerSettingsSchema.safeParse(trainer).success).toBe(false);
  });

  it.each(["rfi", "three-bet", "a", "co_btn", "x0123456789012345678901234567890"])(
    "R3.14 tag %s matches the tag pattern",
    (tag) => {
      expect(tagSchema.safeParse(tag).success).toBe(true);
    },
  );

  it.each(["", "RFI", "-rfi", "has space", "x01234567890123456789012345678901", "é"])(
    "R3.14 tag %j is rejected",
    (tag) => {
      expect(tagSchema.safeParse(tag).success).toBe(false);
    },
  );

  it("R3.14 manual hands need at least one hand class", () => {
    expect(handsFilterSchema.safeParse({ mode: "manual", hands: [] }).success).toBe(false);
    expect(handsFilterSchema.safeParse({ mode: "manual", hands: ["AhKd"] }).success).toBe(false);
    expect(handsFilterSchema.safeParse({ mode: "manual", hands: ["AKo"] }).success).toBe(true);
  });

  it.each([null, 7, 15, 25])("R3.14 timebank_s accepts %j", (timebank) => {
    expect(trainerSettingsSchema.safeParse({ ...TRAINER, timebank_s: timebank }).success).toBe(true);
  });

  it.each([0, 10, 30, "15", undefined])("R3.14 timebank_s rejects %j", (timebank) => {
    expect(trainerSettingsSchema.safeParse({ ...TRAINER, timebank_s: timebank }).success).toBe(false);
  });

  it("R3.14 the patch schema rejects an empty object", () => {
    expect(drillPatchBodySchema.safeParse({}).success).toBe(false);
  });

  it("R3.14 the patch schema accepts one field and rejects an unknown key", () => {
    expect(drillPatchBodySchema.safeParse({ name: "renamed" }).success).toBe(true);
    expect(drillPatchBodySchema.safeParse({ name: "renamed", extra: 1 }).success).toBe(false);
  });

  it("R3.14 sizing and hands unions reject a missing mode", () => {
    expect(sizingSchema.safeParse({ open_bb: 3 }).success).toBe(false);
    expect(handsFilterSchema.safeParse({ hands: ["AA"] }).success).toBe(false);
  });

  it("R3.14 sizing and hands unions reject an unknown mode", () => {
    expect(sizingSchema.safeParse({ mode: "solver" }).success).toBe(false);
    expect(handsFilterSchema.safeParse({ mode: "some" }).success).toBe(false);
  });
});
