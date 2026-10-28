/**
 * The prediction fixtures (S27 lane A, R3.16, O-26): one prompt per answer kind in session order,
 * and the stand-in judging the mock uses, which follows the api's comparison rules (O-301).
 */
import { describe, expect, it } from "vitest";

import type { PredictionResult } from "../../src/contracts.js";
import { fixturePredictionPrompt, fixturePredictions, judgeFixture } from "../../src/fixtures/prediction.js";

const EMPTY: PredictionResult["truth"] = { text: "", share_pct: null, frequency_pct: null, action_indexes: null, regions: null, band: null };

describe("R3.16 prediction fixtures", () => {
  it("R3.16 one prompt per answer kind, ladders alternating through the levels", () => {
    expect(fixturePredictions.map((entry) => [entry.prompt.ladder, entry.prompt.level, entry.prompt.answer_kind])).toEqual([
      ["range", 1, "yes_no"],
      ["hand", 1, "action"],
      ["range", 2, "percent"],
      ["hand", 2, "band"],
      ["range", 3, "regions"],
      ["hand", 3, "size"],
    ]);
    expect(new Set(fixturePredictions.map((entry) => entry.prompt.prompt_id)).size).toBe(6);
    expect(() => fixturePredictionPrompt("nothing" as never)).toThrow(RangeError);
  });

  it("R3.16 judging follows the api's rules", () => {
    const truth = { ...EMPTY, share_pct: 38.4, regions: ["pairs" as const], action_indexes: [2], band: "50_75" as const };
    expect(judgeFixture(truth, { kind: "yes_no", value: true }, 30)).toBe(true);
    expect(judgeFixture(truth, { kind: "yes_no", value: true }, 40)).toBe(false);
    expect(judgeFixture(truth, { kind: "percent", value: 40 }, null)).toBe(true);
    expect(judgeFixture(truth, { kind: "percent", value: 45 }, null)).toBe(false);
    expect(judgeFixture(truth, { kind: "regions", value: ["pairs"] }, null)).toBe(true);
    expect(judgeFixture(truth, { kind: "regions", value: ["suited_aces"] }, null)).toBe(false);
    expect(judgeFixture(truth, { kind: "action", action_index: 2 }, null)).toBe(true);
    expect(judgeFixture(truth, { kind: "size", action_index: 3 }, null)).toBe(false);
    expect(judgeFixture(truth, { kind: "band", band: "50_75" }, null)).toBe(true);
  });

  it("R3.16 a truth without the compared number never judges an answer right", () => {
    expect(judgeFixture(EMPTY, { kind: "yes_no", value: true }, null)).toBe(false);
    expect(judgeFixture(EMPTY, { kind: "percent", value: 50 }, null)).toBe(false);
    expect(judgeFixture(EMPTY, { kind: "regions", value: ["pairs"] }, null)).toBe(false);
    expect(judgeFixture(EMPTY, { kind: "action", action_index: 0 }, null)).toBe(false);
    expect(judgeFixture(EMPTY, { kind: "band", band: "0_25" }, null)).toBe(false);
  });
});
