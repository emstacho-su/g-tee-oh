/**
 * The session start spec (S32, R4.10, O-325, O-328): the POST /sessions body each mode sends. An
 * automated body carries grouping and rng only, config_ids only when a scope is chosen, and never
 * a seed (a client seed makes the session unrated); a holdout body is its mode alone.
 */
import { describe, expect, it } from "vitest";

import { sessionCreateBody } from "../../src/trainer/session-api.js";

const DRILL_ID = "00000000-0000-4000-8000-000000000010";
const SEED = "0123456789abcdef";
const CONFIG_IDS = ["cfg_6_online_100", "cfg_6_online_200"] as const;

describe("R4.10 session start spec", () => {
  it("R4.10 a drill start sends its drill id, settings.rng and the seed when given (S25 unchanged)", () => {
    expect(sessionCreateBody({ mode: "drill", drillId: DRILL_ID, seed: SEED }, true)).toEqual({
      mode: "drill",
      drill_id: DRILL_ID,
      settings: { rng: true },
      seed: SEED,
    });
    expect(sessionCreateBody({ mode: "drill", drillId: DRILL_ID, seed: undefined }, false)).toEqual({
      mode: "drill",
      drill_id: DRILL_ID,
      settings: { rng: false },
    });
  });

  it("R4.10 an automated start over every configuration sends grouping and rng, no config_ids and no seed", () => {
    const body = sessionCreateBody({ mode: "automated", grouping: "grouped", configIds: null }, true);
    expect(body).toEqual({ mode: "automated", settings: { grouping: "grouped", rng: true } });
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("config_ids");
  });

  it("R4.10 an automated start with a chosen scope sends config_ids as a copy, still with no seed", () => {
    const body = sessionCreateBody({ mode: "automated", grouping: "standard", configIds: CONFIG_IDS }, false);
    expect(body).toEqual({ mode: "automated", settings: { grouping: "standard", rng: false }, config_ids: [...CONFIG_IDS] });
    expect(body.config_ids).not.toBe(CONFIG_IDS);
    expect(body).not.toHaveProperty("seed");
  });

  it("R4.10 a holdout start sends its mode alone, whatever the RNG choice (O-328)", () => {
    expect(sessionCreateBody({ mode: "holdout" }, true)).toEqual({ mode: "holdout" });
  });
});
