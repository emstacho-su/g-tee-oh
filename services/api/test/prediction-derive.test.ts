/**
 * R3.16 prediction prompt derivation over a fake SolverPort (O-301, O-302): the paths the fixture
 * library never takes. A deal with no solution, a node whose seat to act is not the spot's hero
 * seat, a node that offers no question on either ladder and a session row without prediction state
 * are upstream or internal problems; a ladder with no question falls back to the other; a node
 * without a spot class reads the "unclassified" history. The nodes are small invented ones in the
 * solver-query NodeResponse shape.
 */
import { describe, expect, it } from "vitest";

import type { PredictionAnswerRecord } from "@g-tee-oh/learning";

import { HTTP_STATUS, ProblemError } from "../src/http/problem.js";
import { derivePrediction, type HistoryReader } from "../src/prediction/derive.js";
import type { TrainerSettings } from "../src/schemas/drills.js";
import type { SqDeal, SqNode } from "../src/solver-query/client.js";
import type { SessionRow } from "../src/sessions/repository.js";
import type { SolverPort } from "../src/sessions/solver-port.js";
import { initialState, type HeroSpot } from "../src/sessions/state.js";

const SOLUTION_ID = "f99b054c-6f19-8e69-8003-24060ce3cef7";
const NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const SPOT: HeroSpot = {
  config_id: "cfg_6_online_100",
  pair: "BB-BTN",
  line: "r250",
  hero_seat: "BB",
  history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
};
const FOLD: SqNode["actions"][number] = { index: 0, token: "f", kind: "fold", label: "Fold", size_cbb: 0, bucket: null, next_node_key: null };
const CALL: SqNode["actions"][number] = { index: 1, token: "c", kind: "call", label: "Call", size_cbb: 250, bucket: null, next_node_key: null };

function row(hand: string, strategy: number[], reach: number[] = [1, 1]): SqNode["hands"][number] {
  return { hand, strategy, ev_bb: strategy.map(() => 0), ev_best_bb: 0, loss_pct_pot: strategy.map(() => 0), mixed: false, reach };
}

function node(overrides: Partial<SqNode> = {}): SqNode {
  return {
    solution_id: SOLUTION_ID,
    node_key: NODE_KEY,
    config_id: "cfg_6_online_100",
    pair: "BB-BTN",
    street: "preflop",
    to_act: "BB",
    pot_cbb: 400,
    stacks_cbb: [9900, 9750],
    floor_pct_pot: 0.5,
    hand_space: "preflop_169",
    hands: [row("AA", [0.2, 0.8])],
    actions: [FOLD, CALL],
    noise_flags: [],
    range_summary: {
      by_action: [
        { index: 0, share: 0.4 },
        { index: 1, share: 0.6 },
      ],
      ip: { combos: 0, reach_weighted_combos: 0 },
      oop: { combos: 0, reach_weighted_combos: 0 },
    },
    spot_class_key: "preflop/online/100/facing-open/BB-BTN",
    synthetic: true,
    ...overrides,
  };
}

function deal(solutionIds: string[] = [SOLUTION_ID]): SqDeal {
  return {
    deal_id: "00000000-0000-4000-8000-000000000001",
    solution_ids: solutionIds,
    start_node_key: NODE_KEY,
    hero_position: "BB",
    villain_position: "BTN",
    hero_hand: "AhAd",
    villain_hand: "KhKd",
    revealed: {},
  };
}

/** A port answering only the two calls derivation makes; any other call fails the test. */
function fakePort(dealt: SqDeal, read: SqNode): SolverPort {
  const unexpected = () => Promise.reject(new Error("derivation made an unexpected solver-query call"));
  return {
    deal: () => Promise.resolve(dealt),
    node: () => Promise.resolve(read),
    nodeForHand: unexpected,
    sample: unexpected,
    reveal: unexpected,
    grade: unexpected,
    coverage: unexpected,
    gradeRange: unexpected,
  };
}

function session(counter = 0, withPractice = true): SessionRow {
  const state = initialState("00000000deadbeef", [SPOT], { preflop_action: ["vs_open"], hands: { mode: "all" }, alternate_seats: false }, "prediction");
  return {
    id: "0192f0a0-0000-7000-8000-000000000001",
    userId: "0192f0a0-0000-7000-8000-000000000002",
    mode: "prediction",
    drillId: "0192f0a0-0000-7000-8000-000000000003",
    settings: {} as TrainerSettings,
    state: withPractice ? { ...state, practice: { kind: "prediction", counter, data: {} } } : { ...state, practice: undefined },
    stateVersion: 0,
    startedAt: new Date(0),
    endedAt: null,
  };
}

const NO_HISTORY: HistoryReader = () => Promise.resolve([]);

async function problemOf(call: Promise<unknown>): Promise<ProblemError> {
  const error = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProblemError)) throw new Error("expected a problem");
  return error;
}

describe("R3.16 prediction derivation over a fake solver-query", () => {
  it("R3.16 a deal with no solution is a 502 upstream problem", async () => {
    const problem = await problemOf(derivePrediction(session(), fakePort(deal([]), node()), NO_HISTORY));
    expect(problem.status).toBe(HTTP_STATUS.badGateway);
  });

  it("R3.16 a node whose seat to act is not the spot's hero seat is a 502 upstream problem", async () => {
    const problem = await problemOf(derivePrediction(session(), fakePort(deal(), node({ to_act: "BTN" })), NO_HISTORY));
    expect(problem.status).toBe(HTTP_STATUS.badGateway);
  });

  it("R3.16 a node with no question on either ladder is a 502 upstream problem", async () => {
    const bare = node({ actions: [FOLD], hands: [row("AA", [1], [0, 1])], range_summary: { ...node().range_summary, by_action: [{ index: 0, share: 1 }] } });
    const problem = await problemOf(derivePrediction(session(), fakePort(deal(), bare), NO_HISTORY));
    expect(problem.status).toBe(HTTP_STATUS.badGateway);
  });

  it("R3.16 a prediction session row without prediction state is a 500", async () => {
    const problem = await problemOf(derivePrediction(session(0, false), fakePort(deal(), node()), NO_HISTORY));
    expect(problem.status).toBe(HTTP_STATUS.internal);
  });

  it("R3.16 a range prompt with no non-fold action falls back to the hand ladder", async () => {
    const foldOnly = node({ actions: [FOLD], hands: [row("AA", [1])], range_summary: { ...node().range_summary, by_action: [{ index: 0, share: 1 }] } });
    const derived = await derivePrediction(session(0), fakePort(deal(), foldOnly), NO_HISTORY);
    expect(derived.question).toMatchObject({ ladder: "hand", hand: "AA", answer_kind: "action" });
  });

  it("R3.16 an odd counter asks the hand ladder first, and a node without a spot class reads the unclassified history", async () => {
    const asked: string[] = [];
    const reader: HistoryReader = (key) => {
      asked.push(key);
      return Promise.resolve<PredictionAnswerRecord[]>([]);
    };
    const derived = await derivePrediction(session(1), fakePort(deal(), node({ spot_class_key: null })), reader);
    expect(derived.question.ladder).toBe("hand");
    expect(derived.spotClassKey).toBe("unclassified");
    expect(asked).toEqual(["unclassified"]);
    expect(derived.counter).toBe(1);
  });
});
