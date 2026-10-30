/**
 * Tests for the per-browser saved spots (S45, R3.27, O-460): a spot is the five settings that name
 * a configuration and a pair; a stored last spot, starred list or recent list is validated on read
 * (anything malformed is dropped, never sent to the api); the recent list keeps the last ten
 * confirmed searches, newest first, one entry per spot and line; starring toggles one spot, newest
 * first, at most fifty; the store survives a missing or throwing storage and writes through guarded
 * storage under the keys registered in preference-keys.ts.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_RECENT_SPOTS,
  MAX_STARRED_SPOTS,
  isStarred,
  parseLastSpot,
  parseRecentSpots,
  parseStarredSpots,
  pushRecent,
  spotOf,
  toggleStar,
} from "../../src/study/saved-spots.js";
import { STUDY_LAST_SPOT_STORAGE_KEY, STUDY_RECENT_STORAGE_KEY, STUDY_STARRED_STORAGE_KEY } from "../../src/store/preference-keys.js";
import { createStudySpotsStore } from "../../src/store/study-spots.js";
import { memoryStorage, throwingStorage } from "../support/storage.js";

const STAKE = "00000000-0000-4000-8000-0000000000a1";
const SPOT = { format: "online", table_size: 6, stake: STAKE, depth: 10000, pair: "BB-BTN" } as const;
const OTHER = { ...SPOT, pair: "SB-BTN" } as const;

describe("R3.27 spots and their validation", () => {
  it("R3.27 spotOf keeps the five settings of a complete search and nothing else", () => {
    expect(spotOf({ ...SPOT, line: "r250", hand: "AKs", mode: "ev" })).toEqual(SPOT);
    expect(spotOf({ format: "online", table_size: 6 })).toBeUndefined();
  });

  it("R3.27 a stored last spot is read through the study validator and needs all five settings", () => {
    expect(parseLastSpot({ ...SPOT, line: "r250", mode: "ev", hand: "AKs" })).toEqual({ ...SPOT, line: "r250", mode: "ev", hand: "AKs" });
    expect(parseLastSpot({ ...SPOT, line: "R250..", hand: "AKx" })).toEqual(SPOT);
    expect(parseLastSpot({ format: "online" })).toBeNull();
    expect(parseLastSpot("not a spot")).toBeNull();
    expect(parseLastSpot(null)).toBeNull();
  });

  it("R3.27 stored lists drop malformed entries and are capped", () => {
    expect(parseStarredSpots([SPOT, { pair: "XX-YY" }, 4, OTHER])).toEqual([SPOT, OTHER]);
    expect(parseStarredSpots("x")).toEqual([]);
    const many = Array.from({ length: 70 }, (_, index) => ({ ...SPOT, depth: 1000 + index }));
    expect(parseStarredSpots(many)).toHaveLength(MAX_STARRED_SPOTS);
    expect(parseRecentSpots(many)).toHaveLength(MAX_RECENT_SPOTS);
    expect(parseRecentSpots([{ ...SPOT, line: "r250" }, null])).toEqual([{ ...SPOT, line: "r250" }]);
  });
});

describe("R3.27 recent and starred rules", () => {
  it("R3.27 pushRecent puts the newest first, keeps one entry per spot and line, and keeps ten", () => {
    const first = pushRecent([], { ...SPOT, mode: "ev" });
    expect(first).toEqual([{ ...SPOT, mode: "ev" }]);
    const second = pushRecent(first, { ...SPOT, line: "r250" });
    expect(second).toEqual([{ ...SPOT, line: "r250" }, { ...SPOT, mode: "ev" }]);
    expect(pushRecent(second, { ...SPOT, hand: "AKs" })).toEqual([{ ...SPOT, hand: "AKs" }, { ...SPOT, line: "r250" }]);
    const full = Array.from({ length: 12 }, (_, index) => ({ ...SPOT, depth: 1000 + index })).reduce(pushRecent, [] as ReturnType<typeof pushRecent>);
    expect(full).toHaveLength(MAX_RECENT_SPOTS);
    expect(full[0]?.depth).toBe(1011);
  });

  it("R3.27 toggleStar adds a spot first, removes it on the second toggle, and never lists one twice", () => {
    const starred = toggleStar([OTHER], SPOT);
    expect(starred).toEqual([SPOT, OTHER]);
    expect(isStarred(starred, { ...SPOT, line: "r250" })).toBe(true);
    expect(toggleStar(starred, SPOT)).toEqual([OTHER]);
  });
});

describe("R3.27 the saved spots store", () => {
  it("R3.27 records a confirmed spot as the last and the newest recent, and writes both keys", () => {
    const storage = memoryStorage();
    const store = createStudySpotsStore({ storage });
    store.getState().recordConfirmed({ ...SPOT, line: "r250" });
    expect(store.getState().last).toEqual({ ...SPOT, line: "r250" });
    expect(store.getState().recent).toEqual([{ ...SPOT, line: "r250" }]);
    expect(JSON.parse(storage.getItem(STUDY_LAST_SPOT_STORAGE_KEY) ?? "null")).toEqual({ ...SPOT, line: "r250" });
    expect(JSON.parse(storage.getItem(STUDY_RECENT_STORAGE_KEY) ?? "null")).toEqual([{ ...SPOT, line: "r250" }]);
  });

  it("R3.27 an incomplete search is never recorded; clearLast forgets the last spot only", () => {
    const store = createStudySpotsStore({ storage: memoryStorage() });
    store.getState().recordConfirmed({ format: "online" });
    expect(store.getState().last).toBeNull();
    store.getState().recordConfirmed(SPOT);
    store.getState().clearLast();
    expect(store.getState().last).toBeNull();
    expect(store.getState().recent).toEqual([SPOT]);
  });

  it("R3.27 toggleStar writes the starred key and a new store reads it back", () => {
    const storage = memoryStorage();
    createStudySpotsStore({ storage }).getState().toggleStar({ ...SPOT, line: "r250" });
    expect(JSON.parse(storage.getItem(STUDY_STARRED_STORAGE_KEY) ?? "null")).toEqual([SPOT]);
    expect(createStudySpotsStore({ storage }).getState().starred).toEqual([SPOT]);
  });

  it("R3.27 a throwing or missing storage leaves the store working for the page", () => {
    for (const storage of [throwingStorage(), null]) {
      const store = createStudySpotsStore({ storage });
      store.getState().recordConfirmed(SPOT);
      store.getState().toggleStar(SPOT);
      expect(store.getState().last).toEqual(SPOT);
      expect(store.getState().starred).toEqual([SPOT]);
    }
  });

  it("R3.27 reload reads the storage again, so a cleared storage empties the store", () => {
    const storage = memoryStorage();
    const store = createStudySpotsStore({ storage });
    store.getState().recordConfirmed(SPOT);
    storage.clear();
    store.getState().reload();
    expect(store.getState()).toMatchObject({ last: null, recent: [], starred: [] });
  });
});
