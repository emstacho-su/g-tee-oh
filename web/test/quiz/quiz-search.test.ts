/**
 * The /quiz, /predict and /paint address rules and the catalog-spot model (S41, R3.16, R3.17,
 * O-414, O-415, O-416, O-419): the router keeps every value a string, so each validator keeps a
 * value only in the shape the api accepts; a full valid choice is what starts a session; the old
 * /predict address keeps drill and seed and drops the rest; a seat is covered when any available
 * pair holds it.
 */
import { describe, expect, it } from "vitest";

import { fixtureConfigs, fixturePairsByConfig } from "../../src/fixtures/study.js";
import {
  SPOT_TYPE_OPTIONS,
  coveredSeats,
  defaultConfigId,
  opponentSeats,
  servedConfigs,
} from "../../src/practice/catalog-spot.js";
import { paintChoiceOf, paintSearchOf, validatePaintSearch } from "../../src/practice/paint-search.js";
import { predictRedirectSearch, quizChoiceOf, quizSearchOf, validateQuizSearch } from "../../src/practice/quiz-search.js";

const DRILL = "00000000-0000-4000-8000-000000000005";
const SEED = "00000000deadbeef";
const FULL = { config: "cfg_6_online_100", positions: "BTN,CO", spots: "rfi,vs_open", kinds: "range,hand", difficulty: "easy" };

describe("R3.16 the /quiz address", () => {
  it("R3.16 keeps each valid value and drops the rest", () => {
    expect(validateQuizSearch({ ...FULL, seed: SEED, extra: "x" })).toEqual({ ...FULL, seed: SEED });
    expect(validateQuizSearch({ config: "nope", positions: "BTN,XX", spots: "rfi,srp", kinds: "range,range", difficulty: "insane", seed: "XYZ" })).toEqual({});
    expect(validateQuizSearch({ drill: DRILL, seed: SEED })).toEqual({ drill: DRILL, seed: SEED });
    expect(validateQuizSearch({ positions: "" })).toEqual({});
  });

  it("R3.16 a full valid choice reads as a quiz choice; a partial one does not", () => {
    expect(quizChoiceOf(validateQuizSearch(FULL))).toEqual({
      config: "cfg_6_online_100",
      positions: ["BTN", "CO"],
      spots: ["rfi", "vs_open"],
      kinds: ["range", "hand"],
      difficulty: "easy",
    });
    expect(quizChoiceOf(validateQuizSearch({ ...FULL, kinds: undefined }))).toBeNull();
    expect(quizChoiceOf(validateQuizSearch({ ...FULL, difficulty: "hardest" }))).toBeNull();
  });

  it("R3.16 a choice writes back to the same address, with the seed when there is one", () => {
    const choice = quizChoiceOf(validateQuizSearch(FULL));
    if (choice === null) throw new Error("expected a choice");
    expect(quizSearchOf(choice, undefined)).toEqual(FULL);
    expect(quizSearchOf(choice, SEED)).toEqual({ ...FULL, seed: SEED });
  });

  it("R3.16 the old /predict address keeps drill and seed and drops unknown parameters (O-419, PM rule)", () => {
    expect(predictRedirectSearch({ drill: DRILL, seed: SEED, other: "1" })).toEqual({ drill: DRILL, seed: SEED });
    expect(predictRedirectSearch({ drill: "not-a-uuid", seed: "short" })).toEqual({});
  });
});

describe("R3.17 the /paint address", () => {
  it("R3.17 keeps a valid table, seat, spot, opener and seed", () => {
    const search = { config: "cfg_6_online_100", position: "BB", spot: "vs_open", vs: "BTN", seed: SEED };
    expect(validatePaintSearch({ ...search, junk: "1" })).toEqual(search);
    expect(validatePaintSearch({ config: "x", position: "ZZ", spot: "limp", vs: "XX", seed: "1" })).toEqual({});
    expect(validatePaintSearch({ drill: DRILL })).toEqual({ drill: DRILL });
  });

  it("R3.17 an opener equal to the hero seat is dropped", () => {
    expect(validatePaintSearch({ position: "BB", vs: "BB" })).toEqual({ position: "BB" });
  });

  it("R3.17 a full choice needs a table, a seat and a spot; the opener is optional", () => {
    expect(paintChoiceOf(validatePaintSearch({ config: "cfg_6_online_100", position: "BB", spot: "vs_open" }))).toEqual({
      config: "cfg_6_online_100",
      position: "BB",
      spot: "vs_open",
      vs: null,
    });
    expect(paintChoiceOf(validatePaintSearch({ config: "cfg_6_online_100", spot: "rfi" }))).toBeNull();
    expect(paintSearchOf({ config: "cfg_6_online_100", position: "BB", spot: "vs_open", vs: "BTN" }, SEED)).toEqual({
      config: "cfg_6_online_100",
      position: "BB",
      spot: "vs_open",
      vs: "BTN",
      seed: SEED,
    });
  });
});

describe("R3.16 R3.17 the catalog-spot model", () => {
  it("R3.16 offers the five spot types of O-416 in order with plain names", () => {
    expect(SPOT_TYPE_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ["rfi", "Open"],
      ["vs_open", "Facing an open"],
      ["vs_three_bet", "Facing a 3-bet"],
      ["squeeze", "Squeeze"],
      ["four_bet", "Facing a 4-bet"],
    ]);
  });

  it("R3.16 a seat is covered when any available pair holds it", () => {
    const pairs = fixturePairsByConfig["cfg_6_online_100"] ?? [];
    expect(coveredSeats(pairs, ["UTG", "HJ", "CO", "BTN", "SB", "BB"])).toEqual(["BTN", "SB", "BB"]);
    expect(coveredSeats([], ["BTN", "BB"])).toEqual([]);
  });

  it("R3.17 the opponents of a seat are the other seats of its available pairs, in seat order", () => {
    const pairs = fixturePairsByConfig["cfg_6_online_100"] ?? [];
    expect(opponentSeats(pairs, "BTN", ["UTG", "HJ", "CO", "BTN", "SB", "BB"])).toEqual(["SB", "BB"]);
    expect(opponentSeats(pairs, "BB", ["UTG", "HJ", "CO", "BTN", "SB", "BB"])).toEqual(["BTN"]);
  });

  it("R3.16 serves only configurations without an ante, and preselects the defaults' first one when the scope is a list", () => {
    const ante = { ...fixtureConfigs[0], config_id: "cfg_6_online_100_ante10", ante_cbb: 10 } as (typeof fixtureConfigs)[number];
    const served = servedConfigs([...fixtureConfigs, ante]);
    expect(served.map((config) => config.config_id)).toEqual(fixtureConfigs.map((config) => config.config_id));
    expect(defaultConfigId(served, ["cfg_6_online_200"])).toBe("cfg_6_online_200");
    expect(defaultConfigId(served, ["cfg_9_missing_100"])).toBe("cfg_6_online_100");
    expect(defaultConfigId(served, "all")).toBe("cfg_6_online_100");
    expect(defaultConfigId([], "all")).toBeNull();
  });
});
