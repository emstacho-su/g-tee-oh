/**
 * The seven v1 tracks and the one track of each spot class (R4.11, O-271, 06 section 2): every
 * Rust action family at every seat maps to exactly the track the table names, squeeze and
 * facing-open split by the blinds, an unknown family maps to none, and the table equals the track
 * rows the migration seeds (20261029000100_api_learning.sql).
 */
import { describe, expect, it } from "vitest";

import { TRACK_ENABLED_WEIGHT, TRACK_FAMILY, TRACK_FORMAT } from "../src/learning/tracks.js";
import { appDatabase } from "./support/database.js";

import { POSITIONS } from "../src/schemas/common.js";
import { RUST_ACTION_FAMILIES } from "../src/sessions/action-family.js";
import { TRACK_KEYS, TRACKS, trackDefinition, trackFor, type TrackKey } from "../src/learning/tracks.js";

const BLINDS = new Set<string>(["SB", "BB"]);

function expectedTrack(family: string, seat: string): TrackKey | null {
  switch (family) {
    case "rfi":
      return "opens";
    case "facing-open":
    case "squeeze":
      return BLINDS.has(seat) ? "blind-defense" : "facing-open-ip";
    case "facing-3bet":
      return "facing-3bet";
    case "facing-4bet":
      return "four-bet-plus";
    case "blind-vs-blind":
      return "blind-vs-blind";
    case "limped-isolation":
    case "straddled-pot":
      return "live-limped-straddled";
    default:
      return null;
  }
}

describe("R4.11 tracks", () => {
  it("R4.11 every family at every seat maps to its one track", () => {
    for (const family of RUST_ACTION_FAMILIES) {
      for (const seat of POSITIONS) {
        expect(trackFor(family, seat), `${family} at ${seat}`).toBe(expectedTrack(family, seat));
      }
    }
  });

  it("R4.11 an unknown or missing family maps to no track", () => {
    expect(trackFor("flop-cbet", "BTN")).toBeNull();
    expect(trackFor(null, "BB")).toBeNull();
  });

  it("R4.11 the table holds the seven keys in order, each family once per seat rule", () => {
    expect(TRACKS.map((track) => track.key)).toEqual([...TRACK_KEYS]);
    for (const key of TRACK_KEYS) {
      expect(trackDefinition(key).key).toBe(key);
    }
    const live = trackDefinition("live-limped-straddled");
    expect(live.scope.formats).toEqual(["live"]);
    expect(() => trackDefinition("nope" as TrackKey)).toThrow(RangeError);
  });

  it("R4.11 the migration seeds exactly this table: key, scope, family, format and weight", async () => {
    const database = appDatabase();
    try {
      const rows = await database.selectFrom("track").select(["key", "family", "format", "scope", "weight"]).orderBy("key").execute();
      const expected = TRACKS.map((track) => ({
        key: track.key,
        family: TRACK_FAMILY,
        format: TRACK_FORMAT,
        scope: { families: [...track.scope.families], hero: track.scope.hero, formats: [...track.scope.formats] },
        weight: TRACK_ENABLED_WEIGHT,
      })).sort((a, b) => a.key.localeCompare(b.key));
      expect(rows).toEqual(expected);
    } finally {
      await database.destroy();
    }
  });
});
