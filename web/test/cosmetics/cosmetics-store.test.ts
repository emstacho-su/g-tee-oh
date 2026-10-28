/**
 * The cosmetics store (S32, R4.14, O-323): default none per slot, a valid round trip through
 * storage, stale and tampered values falling back slot by slot, storage that throws, and the
 * effective choice that keeps only unlocked items.
 */
import { describe, expect, it } from "vitest";

import {
  COSMETICS_STORAGE_KEY,
  createCosmeticsStore,
  effectiveCosmetics,
  hasAnyChoice,
  NO_COSMETICS,
  parseCosmeticChoices,
} from "../../src/store/index.js";
import { memoryStorage, throwingStorage } from "../support/storage.js";

describe("R4.14 cosmetics store", () => {
  it("R4.14 starts with no cosmetic in any slot", () => {
    const store = createCosmeticsStore({ storage: memoryStorage() });
    expect(store.getState().choices).toEqual(NO_COSMETICS);
    expect(hasAnyChoice(store.getState().choices)).toBe(false);
  });

  it("R4.14 an equipped item is written and read back by a fresh store", () => {
    const storage = memoryStorage();
    const store = createCosmeticsStore({ storage });
    const before = store.getState().choices;
    store.getState().equip("felt", "felt-tier-V");
    store.getState().equip("card-back", "card-back-streak-14");
    expect(store.getState().choices).not.toBe(before);
    expect(before).toEqual(NO_COSMETICS);
    expect(createCosmeticsStore({ storage }).getState().choices).toEqual({ "card-back": "card-back-streak-14", felt: "felt-tier-V", badge: null });
    store.getState().equip("felt", null);
    expect(createCosmeticsStore({ storage }).getState().choices.felt).toBeNull();
  });

  it("R4.14 equipping a key of another kind or outside the catalog throws and changes nothing", () => {
    const store = createCosmeticsStore({ storage: memoryStorage() });
    expect(() => store.getState().equip("felt", "badge-tier-III")).toThrow(RangeError);
    expect(() => store.getState().equip("badge", "badge-gold")).toThrow(RangeError);
    expect(store.getState().choices).toEqual(NO_COSMETICS);
  });

  it("R4.14 stale, wrong-kind and tampered stored values fall back slot by slot", () => {
    const stored = JSON.stringify({ "card-back": "card-back-streak-999", felt: "badge-tier-III", badge: "badge-streak-7" });
    const store = createCosmeticsStore({ storage: memoryStorage({ [COSMETICS_STORAGE_KEY]: stored }) });
    expect(store.getState().choices).toEqual({ "card-back": null, felt: null, badge: "badge-streak-7" });
    expect(parseCosmeticChoices("felt-tier-III")).toEqual(NO_COSMETICS);
    expect(parseCosmeticChoices([1, 2])).toEqual(NO_COSMETICS);
    expect(parseCosmeticChoices({ felt: 7 })).toEqual(NO_COSMETICS);
    const broken = createCosmeticsStore({ storage: memoryStorage({ [COSMETICS_STORAGE_KEY]: "{not json" }) });
    expect(broken.getState().choices).toEqual(NO_COSMETICS);
  });

  it("R4.14 storage that throws or is missing leaves the defaults and still equips for this page", () => {
    for (const storage of [throwingStorage(), null]) {
      const store = createCosmeticsStore({ storage });
      expect(store.getState().choices).toEqual(NO_COSMETICS);
      store.getState().equip("badge", "badge-tier-II");
      expect(store.getState().choices.badge).toBe("badge-tier-II");
    }
  });

  it("R4.14 the effective choice keeps only items the server has unlocked", () => {
    const choices = { "card-back": "card-back-streak-60", felt: "felt-tier-III", badge: "badge-streak-7" };
    expect(effectiveCosmetics(choices, new Set(["felt-tier-III", "badge-streak-7"]))).toEqual({ "card-back": null, felt: "felt-tier-III", badge: "badge-streak-7" });
    expect(effectiveCosmetics(choices, new Set())).toEqual(NO_COSMETICS);
    expect(effectiveCosmetics(NO_COSMETICS, new Set(["felt-tier-III"]))).toEqual(NO_COSMETICS);
  });
});
