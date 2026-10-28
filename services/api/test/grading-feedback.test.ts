/**
 * Grading inputs and feedback rendering (R3.7, R3.8, R3.10, O-92, O-210, O-213, ADR 0004, ADR 0024):
 * the learning policy's input is built from solver-query's numbers only, the best actions are
 * learning's lowest-loss groups (the rule grade() labels Best by; the roll and the frequencies never
 * enter it), labels map to the contract's lowercase once, and feedback, with its followed-the-roll
 * mark, is a pure function of the stored attempt row.
 */
import { LOSS_TIE_TOLERANCE_PCT_POT, type GradeAction } from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import { feedbackSchema } from "../src/schemas/training.js";
import { CONTRACT_LABELS, renderFeedback, toContractLabel, type FeedbackRow } from "../src/grading/feedback.js";
import { bestActionIndexes, buildGradeInput, gradeActions, panelsRevealAnswer } from "../src/grading/policy.js";
import type { TrainerSettings } from "../src/schemas/drills.js";
import type { SqGrade, SqNode } from "../src/solver-query/client.js";

const SETTINGS: TrainerSettings = {
  stop_rule: "after_action",
  input: "actions",
  grouping: "standard",
  rng: false,
  pause: "never",
  speed: "normal",
  quick_result: false,
  tables: 1,
  timebank_s: null,
  panels: {},
};

const NODE = {
  street: "preflop",
  actions: [
    { index: 0, token: "f", kind: "fold", size_cbb: 0, bucket: null, label: "Fold", next_node_key: null },
    { index: 1, token: "c", kind: "call", size_cbb: 250, bucket: null, label: "Call", next_node_key: null },
    { index: 2, token: "r1000", kind: "raise", size_cbb: 1000, bucket: "overbet-large", label: "Raise to 10bb", next_node_key: "k/r" },
  ],
} as unknown as SqNode;

const GRADE = {
  freq_by_action: [0.2, 0.4, 0.4],
  ev_by_action: [0, 1.5, 1.5],
  loss_pct_pot_by_action: [37.5, 0, 0],
  loss_pct_pot: 37.5,
  floor_pct_pot: 0.5,
  noise_flags: ["close_ev_mix"],
} as unknown as SqGrade;

const ROW: FeedbackRow = {
  id: "0190f000-0000-7000-8000-000000000001",
  label: "correct",
  score: 1,
  ev_loss_bb: 0,
  ev_loss_pct_pot: 0,
  best_action_indexes: [1, 2],
  freq_by_action: [0.2, 0.4, 0.4],
  ev_by_action: [0, 1.5, 1.5],
  rated: false,
  rng_roll: null,
  followed_roll: null,
  state_version: 4,
  solution_id: "0190f000-0000-7000-8000-0000000000aa",
  node_key: "cfg_6_online_100/BB-BTN/",
  hand: "AhKd",
  item_difficulty: null,
  noise_flags: ["close_ev_mix"],
  spot_class_key: "srp-btn-open",
  game_config_id: "cfg_6_online_100",
  position_pair: "BB-BTN",
};

describe("R3.7 grading inputs and feedback", () => {
  it("R3.7 grade actions pair the node's actions with solver-query's per-action loss (O-210)", () => {
    const actions = gradeActions(NODE, GRADE);
    expect(actions).toEqual<GradeAction[]>([
      { kind: "fold", bucket: null, sizeCbb: 0, lossPctPot: 37.5 },
      { kind: "call", bucket: null, sizeCbb: 250, lossPctPot: 0 },
      { kind: "raise", bucket: "overbet-large", sizeCbb: 1000, lossPctPot: 0 },
    ]);
  });

  it("R3.7 a per-action list of another length is a 502 upstream problem", () => {
    const short: SqGrade = { ...GRADE, loss_pct_pot_by_action: [0, 0] };
    expect(() => gradeActions(NODE, short)).toThrow(expect.objectContaining({ status: 502 }));
    const badBucket = {
      ...NODE,
      actions: NODE.actions.map((action) => ({ ...action, bucket: "huge" })),
    } as unknown as SqNode;
    expect(() => gradeActions(badBucket, GRADE)).toThrow(expect.objectContaining({ status: 502 }));
  });

  it("R3.8 best actions are every action tied for the lowest loss, whatever the frequencies (ADR 0024 rule 4, O-343, O-370)", () => {
    expect(bestActionIndexes(NODE, GRADE, "standard")).toEqual([1, 2]);
    const nearTie: SqGrade = { ...GRADE, loss_pct_pot_by_action: [37.5, 0, LOSS_TIE_TOLERANCE_PCT_POT / 2] };
    expect(bestActionIndexes(NODE, nearTie, "standard")).toEqual([1, 2]);
    const rareRaise: SqGrade = { ...GRADE, freq_by_action: [0.1, 0.89, 0.01], loss_pct_pot_by_action: [37.5, 0.01, 0] };
    expect(bestActionIndexes(NODE, rareRaise, "standard"), "the rarely played raise is the highest EV").toEqual([2]);
  });

  it("R3.8 best actions are the lowest-loss member of each Best group: the Simple raise type is Best but only its best size is named (ADR 0024 rule 4, O-375 amended in review round 1)", () => {
    const sized = {
      ...NODE,
      street: "flop",
      actions: [
        ...NODE.actions,
        { index: 3, token: "r500", kind: "raise", size_cbb: 500, bucket: "pot", label: "Raise to 5bb", next_node_key: "k/r5" },
      ],
    } as unknown as SqNode;
    const grade: SqGrade = { ...GRADE, freq_by_action: [0.1, 0.1, 0.1, 0.7], loss_pct_pot_by_action: [37.5, 0.2, 0, 0.1] };
    expect(bestActionIndexes(sized, grade, "standard")).toEqual([2]);
    expect(bestActionIndexes(sized, grade, "simple")).toEqual([2]);
  });

  it("R3.7 the grade input carries street, grouping, roll, drill mode and the revealing panels", () => {
    const input = buildGradeInput({
      node: NODE,
      grade: GRADE,
      actionIndex: 0,
      rngRoll: 42,
      settings: { ...SETTINGS, grouping: "grouped", panels: { hero_strategy_matrix: true } },
      ratedTodayInTrack: 3,
      mode: "drill",
    });
    expect(input).toMatchObject({
      lossPctPot: 37.5,
      floorPctPot: 0.5,
      freqByAction: [0.2, 0.4, 0.4],
      actionIndex: 0,
      rngRoll: 42,
      noiseFlags: ["close_ev_mix"],
      mode: "drill",
      firstAttempt: true,
      panelsRevealed: true,
      grouping: "grouped",
      ratedTodayInTrack: 3,
      street: "preflop",
    });
    const noRoll = buildGradeInput({ node: NODE, grade: GRADE, actionIndex: 1, rngRoll: null, settings: SETTINGS, ratedTodayInTrack: 0, mode: "drill" });
    expect("rngRoll" in noRoll).toBe(false);
    expect(noRoll.panelsRevealed).toBe(false);
  });

  it("R3.7 only answer-revealing panels unrate a decision", () => {
    expect(panelsRevealAnswer({ ...SETTINGS, panels: { hero_range_matrix: true, streak_counter: true } })).toBe(false);
    expect(panelsRevealAnswer({ ...SETTINGS, panels: { action_frequency_table: true } })).toBe(true);
    expect(panelsRevealAnswer({ ...SETTINGS, panels: { hero_strategy_matrix: false } })).toBe(false);
  });

  it("R3.7 learning labels map to the contract's lowercase labels in one place", () => {
    expect(CONTRACT_LABELS).toEqual({
      Best: "best",
      Correct: "correct",
      Inaccuracy: "inaccuracy",
      Mistake: "mistake",
      Blunder: "blunder",
    });
    expect(toContractLabel("Mistake")).toBe("mistake");
  });

  it("R3.7 feedback renders from the attempt row alone and matches the contract (O-92)", () => {
    const feedback = renderFeedback(ROW);
    expect(feedbackSchema.parse(feedback)).toEqual(feedback);
    expect(feedback).toEqual({
      attempt_id: ROW.id,
      label: "correct",
      score: 1,
      ev_loss_bb: 0,
      ev_loss_pct_pot: 0,
      best_action_indexes: [1, 2],
      freq_by_action: [0.2, 0.4, 0.4],
      ev_by_action: [0, 1.5, 1.5],
      rated: false,
      rng_roll: null,
      followed_roll: null,
      state_version: 5,
      solution_id: ROW.solution_id,
      node_key: "cfg_6_online_100/BB-BTN/",
      config_id: "cfg_6_online_100",
      pair: "BB-BTN",
      hand: "AhKd",
      item_difficulty: null,
      review_block: null,
      noise_flags: ["close_ev_mix"],
      spot_class_key: "srp-btn-open",
    });
    expect(renderFeedback(ROW)).toEqual(feedback);
  });

  it("R3.10 feedback carries the stored followed-the-roll mark in Mixed-frequency mode (ADR 0024 rule 2, O-371)", () => {
    const followed = renderFeedback({ ...ROW, rng_roll: 37, followed_roll: true });
    expect(followed).toMatchObject({ rng_roll: 37, followed_roll: true });
    expect(feedbackSchema.parse(followed)).toEqual(followed);
    expect(renderFeedback({ ...ROW, rng_roll: 90, followed_roll: false }).followed_roll).toBe(false);
  });

  it("R3.7 a row without the S23 columns cannot render feedback", () => {
    expect(() => renderFeedback({ ...ROW, freq_by_action: null })).toThrow(expect.objectContaining({ status: 500 }));
    expect(() => renderFeedback({ ...ROW, position_pair: null })).toThrow(expect.objectContaining({ status: 500 }));
    expect(() => renderFeedback({ ...ROW, label: "great" })).toThrow();
  });
});
