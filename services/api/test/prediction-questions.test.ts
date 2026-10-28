/**
 * R3.16 prediction questions, unit level (O-301, ADR 0004): the region partition, the prompt id and
 * draws, the range and hand ladders' questions at every level, and judging every answer kind. The
 * nodes here are small invented ones built in the solver-query NodeResponse shape; the routes test
 * (prediction-routes.test.ts) runs the same code over the real fixture solver-query.
 */
import { describe, expect, it } from "vitest";

import { ProblemError } from "../src/http/problem.js";
import { laddersFor, promptDraws, promptIdOf } from "../src/prediction/derive.js";
import { FREQUENCY_BANDS, bandOf, handQuestion } from "../src/prediction/hand-questions.js";
import { judgeAnswer } from "../src/prediction/judge.js";
import { actingSeatIndex, actionLabel, frequencyOf, heldRows } from "../src/prediction/question.js";
import { rangeQuestion, targetShare, thresholdChoices } from "../src/prediction/range-questions.js";
import { HAND_REGIONS, allHandClasses, regionOf, regionsHolding } from "../src/prediction/regions.js";
import { uuidSchema } from "../src/schemas/common.js";
import type { SqNode } from "../src/solver-query/client.js";

type Row = SqNode["hands"][number];

const ACTIONS: SqNode["actions"] = [
  { index: 0, token: "f", kind: "fold", label: "Fold", size_cbb: 0, bucket: null, next_node_key: null },
  { index: 1, token: "c", kind: "call", label: "Call", size_cbb: 250, bucket: null, next_node_key: "k/r250.c" },
  { index: 2, token: "r1000", kind: "raise", label: "Raise to 10bb", size_cbb: 1000, bucket: null, next_node_key: "k/r250.r1000" },
  { index: 3, token: "r2500", kind: "raise", label: "Raise to 25bb", size_cbb: 2500, bucket: null, next_node_key: null },
];

function row(hand: string, strategy: number[], options: { mixed?: boolean; reach?: number[] | null } = {}): Row {
  return {
    hand,
    strategy,
    ev_bb: strategy.map(() => 0),
    ev_best_bb: 0,
    loss_pct_pot: strategy.map(() => 0),
    mixed: options.mixed ?? false,
    reach: options.reach === undefined ? [1, 1] : options.reach,
  };
}

function node(hands: Row[], shares: number[] = [0.4, 0.35, 0.2, 0.05], overrides: Partial<SqNode> = {}): SqNode {
  return {
    solution_id: "f99b054c-6f19-8e69-8003-24060ce3cef7",
    node_key: "k/r250",
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    street: "preflop",
    to_act: "BB",
    pot_cbb: 400,
    stacks_cbb: [9900, 9750],
    floor_pct_pot: 0.5,
    hand_space: "preflop_169",
    hands,
    actions: ACTIONS,
    noise_flags: [],
    range_summary: {
      by_action: shares.map((share, index) => ({ index, share })),
      ip: { combos: 0, reach_weighted_combos: 0 },
      oop: { combos: 0, reach_weighted_combos: 0 },
    },
    spot_class_key: "preflop/online/100/facing-open/BB-BTN",
    synthetic: true,
    ...overrides,
  };
}

const DRAWS = { hand: 0n, threshold: 0n };

describe("R3.16 hand regions", () => {
  it("R3.16 every one of the 169 classes is in exactly one region", () => {
    const classes = allHandClasses();
    expect(new Set(classes).size).toBe(169);
    const counts = new Map(HAND_REGIONS.map((region) => [region, 0]));
    for (const handClass of classes) {
      const region = regionOf(handClass);
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      pairs: 13,
      suited_aces: 12,
      suited_broadways: 5,
      suited_connectors: 7,
      suited_other: 54,
      offsuit_aces: 12,
      offsuit_broadways: 6,
      offsuit_other: 60,
    });
  });

  it("R3.16 named classes land in their regions", () => {
    expect(regionOf("55")).toBe("pairs");
    expect(regionOf("A2s")).toBe("suited_aces");
    expect(regionOf("KTs")).toBe("suited_broadways");
    expect(regionOf("JTs")).toBe("suited_connectors");
    expect(regionOf("54s")).toBe("suited_connectors");
    expect(regionOf("43s")).toBe("suited_other");
    expect(regionOf("AKo")).toBe("offsuit_aces");
    expect(regionOf("JTo")).toBe("offsuit_broadways");
    expect(regionOf("72o")).toBe("offsuit_other");
    expect(regionsHolding(["72o", "55", "A7s", "65s"])).toEqual(["pairs", "suited_aces", "suited_connectors", "offsuit_other"]);
  });

  it("R3.16 a name that is not a class written high rank first is refused", () => {
    for (const bad of ["KAs", "AA s", "AKx", "AAs", "Z2o", "A"]) {
      expect(() => regionOf(bad)).toThrow(RangeError);
    }
  });
});

describe("R3.16 prompt identity and draws", () => {
  it("R3.16 the prompt id is a deterministic version 8 UUID per session and counter", () => {
    const session = "0192f0a0-0000-7000-8000-000000000001";
    const first = promptIdOf(session, 0);
    expect(uuidSchema.safeParse(first).success).toBe(true);
    expect(first[14]).toBe("8");
    expect(promptIdOf(session, 0)).toBe(first);
    expect(promptIdOf(session, 1)).not.toBe(first);
  });

  it("R3.16 draws replay from the seed and differ by counter", () => {
    expect(promptDraws("00000000deadbeef", 3)).toEqual(promptDraws("00000000deadbeef", 3));
    expect(promptDraws("00000000deadbeef", 3)).not.toEqual(promptDraws("00000000deadbeef", 4));
    expect(() => promptDraws("00000000deadbeef", -1)).toThrow(RangeError);
  });

  it("R3.16 the ladder alternates: even counters ask the range first, odd the hand", () => {
    expect(laddersFor(0)).toEqual(["range", "hand"]);
    expect(laddersFor(7)).toEqual(["hand", "range"]);
  });
});

describe("R3.16 node facts", () => {
  it("R3.16 the acting seat holds rows with reach above 0 or none recorded", () => {
    const facts = node([row("AA", [0, 0, 1, 0], { reach: [0, 1] }), row("KK", [0, 0, 1, 0], { reach: null }), row("QQ", [0, 0, 1, 0])]);
    expect(actingSeatIndex(facts)).toBe(0);
    expect(heldRows(facts).map((entry) => entry.hand)).toEqual(["KK", "QQ"]);
  });

  it("R3.16 inconsistent node facts are an upstream problem", () => {
    expect(() => actingSeatIndex(node([], undefined, { to_act: "CO" }))).toThrow(ProblemError);
    expect(() => actionLabel(node([]), 9)).toThrow(ProblemError);
    expect(() => frequencyOf(row("AA", [1]), 3)).toThrow(ProblemError);
  });
});

describe("R3.16 range ladder", () => {
  it("R3.16 the target is the non-fold action with the largest share, lowest index on a tie", () => {
    expect(targetShare(node([]))).toEqual({ index: 1, sharePct: 35 });
    expect(targetShare(node([], [0.2, 0.4, 0.4, 0]))?.index).toBe(1);
    expect(targetShare(node([], [1], { actions: [ACTIONS[0] as SqNode["actions"][number]] }))).toBeUndefined();
  });

  it("R3.16 thresholds are multiples of 5 within 15 points of the truth, clamped 5 to 95", () => {
    expect(thresholdChoices(35)).toEqual([20, 25, 30, 35, 40, 45, 50]);
    expect(thresholdChoices(0)).toEqual([5, 10, 15]);
    expect(thresholdChoices(100)).toEqual([85, 90, 95]);
  });

  it("R3.16 level 1 asks yes or no against a drawn threshold and judges share above it", () => {
    const facts = node([]);
    const question = rangeQuestion({ node: facts, level: 1, draws: DRAWS });
    expect(question).toMatchObject({ answer_kind: "yes_no", action_index: 1, threshold_pct: 20, ladder: "range", level: 1 });
    expect(question?.question).toBe("Does BB take Call with more than 20 percent of its range?");
    expect(question?.truth.share_pct).toBe(35);
    if (question === undefined) throw new Error("no question");
    expect(judgeAnswer(question, facts, { kind: "yes_no", value: true })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "yes_no", value: false })).toBe(false);
  });

  it("R3.16 level 2 asks the share and accepts answers within 2.5 points", () => {
    const facts = node([]);
    const question = rangeQuestion({ node: facts, level: 2, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    expect(question.answer_kind).toBe("percent");
    expect(judgeAnswer(question, facts, { kind: "percent", value: 35 })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "percent", value: 37.5 })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "percent", value: 40 })).toBe(false);
  });

  it("R3.16 level 3 asks which regions hold a mixed class the seat holds, exact set", () => {
    const facts = node([
      row("55", [0, 0.5, 0.5, 0], { mixed: true }),
      row("A7s", [0, 0.5, 0.5, 0], { mixed: true }),
      row("72o", [1, 0, 0, 0]),
      row("KQs", [0, 0.5, 0.5, 0], { mixed: true, reach: [0, 1] }),
    ]);
    const question = rangeQuestion({ node: facts, level: 3, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    expect(question.answer_kind).toBe("regions");
    expect(question.regions).toEqual(HAND_REGIONS);
    expect(question.truth.regions).toEqual(["pairs", "suited_aces"]);
    expect(judgeAnswer(question, facts, { kind: "regions", value: ["suited_aces", "pairs"] })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "regions", value: ["pairs"] })).toBe(false);
    expect(judgeAnswer(question, facts, { kind: "regions", value: ["pairs", "suited_aces", "suited_broadways"] })).toBe(false);
  });

  it("R3.16 level 3 with no mixed class says so; a combo node falls back to level 2", () => {
    const pure = rangeQuestion({ node: node([row("72o", [1, 0, 0, 0])]), level: 3, draws: DRAWS });
    expect(pure?.truth.regions).toEqual([]);
    expect(pure?.truth.text).toBe("BB plays every class it holds here with one action.");
    const combos = rangeQuestion({ node: node([], undefined, { hand_space: "postflop_1326" }), level: 3, draws: DRAWS });
    expect(combos?.answer_kind).toBe("percent");
  });
});

describe("R3.16 hand ladder", () => {
  const facts = node([row("AKs", [0, 0.2, 0.3, 0.5], { mixed: true })]);

  it("R3.16 level 1 asks the most frequent action; ties within the tolerance all count", () => {
    const question = handQuestion({ node: facts, level: 1, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    expect(question).toMatchObject({ answer_kind: "action", hand: "AKs", ladder: "hand" });
    expect(judgeAnswer(question, facts, { kind: "action", action_index: 3 })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "action", action_index: 1 })).toBe(false);
    const tied = node([row("55", [0, 0.5, 0.5, 0])]);
    const tie = handQuestion({ node: tied, level: 1, draws: DRAWS });
    expect(tie?.truth.action_indexes).toEqual([1, 2]);
    expect(tie?.truth.text).toBe("BB plays 55 most often as Call or Raise to 10bb (50.0 percent).");
  });

  it("R3.16 level 2 asks the band of the most frequent action, lower edge inclusive", () => {
    const question = handQuestion({ node: facts, level: 2, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    expect(question).toMatchObject({ answer_kind: "band", action_index: 3, bands: ["0_25", "25_50", "50_75", "75_100"] });
    expect(question.truth.band).toBe("50_75");
    expect(judgeAnswer(question, facts, { kind: "band", band: "50_75" })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "band", band: "25_50" })).toBe(false);
    expect(FREQUENCY_BANDS.map((entry) => bandOf(entry.fromPct))).toEqual(["0_25", "25_50", "50_75", "75_100"]);
    expect(bandOf(24.9)).toBe("0_25");
    expect(bandOf(100)).toBe("75_100");
  });

  it("R3.16 level 3 asks the most frequent aggressive size", () => {
    const question = handQuestion({ node: facts, level: 3, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    expect(question.answer_kind).toBe("size");
    expect(judgeAnswer(question, facts, { kind: "size", action_index: 3 })).toBe(true);
    expect(judgeAnswer(question, facts, { kind: "size", action_index: 2 })).toBe(false);
  });

  it("R3.16 level 3 falls back to the band without two aggressive actions or an aggressive frequency of 0.05", () => {
    const passive = node([row("72o", [0.97, 0.03, 0.0, 0.0])]);
    expect(handQuestion({ node: passive, level: 3, draws: DRAWS })?.answer_kind).toBe("band");
    const oneRaise = node([row("AKs", [0, 0.2, 0.8])], [0.4, 0.4, 0.2], { actions: ACTIONS.slice(0, 3) });
    expect(handQuestion({ node: oneRaise, level: 3, draws: DRAWS })?.level).toBe(2);
  });

  it("R3.16 a node where the seat holds no class has no hand question", () => {
    expect(handQuestion({ node: node([row("AA", [1, 0, 0, 0], { reach: [0, 1] })]), level: 1, draws: DRAWS })).toBeUndefined();
  });
});

describe("R3.16 judging refuses answers that do not fit the prompt", () => {
  const facts = node([row("AKs", [0, 0.2, 0.3, 0.5])]);

  it("R3.16 an answer of another kind is a 400 problem", () => {
    const question = handQuestion({ node: facts, level: 1, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    expect(() => judgeAnswer(question, facts, { kind: "yes_no", value: true })).toThrow(/asks for an answer of kind action/);
  });

  it("R3.16 an action the prompt does not offer is a 400 problem; a size must be aggressive", () => {
    const action = handQuestion({ node: facts, level: 1, draws: DRAWS });
    const size = handQuestion({ node: facts, level: 3, draws: DRAWS });
    if (action === undefined || size === undefined) throw new Error("no question");
    expect(() => judgeAnswer(action, facts, { kind: "action", action_index: 9 })).toThrow(ProblemError);
    expect(() => judgeAnswer(size, facts, { kind: "size", action_index: 1 })).toThrow(ProblemError);
  });

  it("R3.16 a question whose truth lacks a number is an internal problem", () => {
    const question = rangeQuestion({ node: facts, level: 1, draws: DRAWS });
    if (question === undefined) throw new Error("no question");
    const broken = { ...question, truth: { ...question.truth, share_pct: null } };
    expect(() => judgeAnswer(broken, facts, { kind: "yes_no", value: true })).toThrow(ProblemError);
  });
});
