/**
 * The street on history entries (S38 review round 1 items b and c, S40, O-398, O-409).
 *
 * - Stored state from before S38 holds history entries without street; it must still parse, in the
 *   hand, the hero spots and previous_hand alike (the contract says "absent on entries stored
 *   before S38").
 * - Class lines are preflop by contract: the automated catalog's hero spots and a holdout item's
 *   replay spot tag every entry "preflop", including an item stored before the field existed.
 */
import { describe, expect, it } from "vitest";

import { heroSpotsOf, type CatalogClass } from "../src/automated/class-catalog.js";
import type { HoldoutItem } from "../src/holdout/repository.js";
import { itemSpot } from "../src/holdout/session-items.js";
import { classLineEntry, historyEntrySchema, persistedStateSchema } from "../src/sessions/state.js";

const OLD_ENTRY = { position: "BTN", token: "r250", label: "Raise to 2.5bb" } as const;
const SEED = "00000000deadbeef";

/** A drill session's state as S26 to S37 stored it: a hand in play and a previous hand, no street anywhere. */
const STORED_BEFORE_S38 = {
  phase: "feedback",
  seed: SEED,
  hand_no: 1,
  spots: [{ config_id: "cfg_6_online_100", pair: "BB-BTN", line: "r250", hero_seat: "BB", history: [OLD_ENTRY] }],
  spot: { preflop_action: ["rfi"], hands: { mode: "all" }, alternate_seats: false },
  hand: {
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    line: "r250",
    deal_seed: SEED,
    deal_id: "deal-1",
    solution_id: "0190f5a2-0000-7000-8000-000000000001",
    hero_position: "BB",
    villain_position: "BTN",
    hero_hand: "AhKd",
    villain_hand: "QcQs",
    street: "preflop",
    node_key: null,
    end: "street_closed",
    last_action_kind: "call",
    history: [OLD_ENTRY, { position: "BB", token: "c", label: "Call" }],
    board: [],
    opponent_rng_state: SEED,
    roll_rng_state: SEED,
  },
  previous_board: null,
  last_attempt_id: null,
  previous_hand: { hand_no: 0, history: [OLD_ENTRY, { position: "BB", token: "f", label: "Fold" }], board: [], end: "fold" },
};

describe("R3.13 history entries stored before S38 have no street (item c)", () => {
  it("R3.13 historyEntrySchema parses an entry without street and keeps it absent", () => {
    const parsed = historyEntrySchema.parse(OLD_ENTRY);
    expect(parsed).toEqual(OLD_ENTRY);
    expect("street" in parsed).toBe(false);
  });

  it("R3.13 a session state stored before S38 parses, with every history entry still without street", () => {
    const parsed = persistedStateSchema.parse(STORED_BEFORE_S38);
    const entries = [...(parsed.hand?.history ?? []), ...(parsed.spots[0]?.history ?? []), ...(parsed.previous_hand?.history ?? [])];
    expect(entries).toHaveLength(5);
    expect(entries.every((entry) => entry.street === undefined)).toBe(true);
  });
});

describe("R4.10 R4.13 class lines carry the preflop street (item b, O-409)", () => {
  it("R4.10 classLineEntry tags the preflop street and drops nothing else", () => {
    expect(classLineEntry(OLD_ENTRY)).toEqual({ ...OLD_ENTRY, street: "preflop" });
  });

  it("R4.10 the automated catalog's hero spots tag every entry preflop", () => {
    const cls = {
      options: [
        {
          configId: "cfg_6_online_100",
          pair: "BB-BTN",
          spots: [{ line: "r250", hero_position: "BB", history: [OLD_ENTRY] }],
        },
      ],
    } as unknown as CatalogClass;
    expect(heroSpotsOf(cls)[0]?.history).toEqual([{ ...OLD_ENTRY, street: "preflop" }]);
  });

  it("R4.13 a holdout item stored without street replays with preflop entries", () => {
    const item = {
      id: "0190f5a2-0000-7000-8000-000000000002",
      configId: "cfg_6_online_100",
      pair: "BB-BTN",
      line: "r250",
      heroPosition: "BB",
      dealSeed: SEED,
      history: [OLD_ENTRY],
    } as unknown as HoldoutItem;
    expect(itemSpot(item).history).toEqual([{ ...OLD_ENTRY, street: "preflop" }]);
  });
});
