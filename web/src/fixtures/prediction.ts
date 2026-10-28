/**
 * Synthetic prediction drill fixtures typed against the api contract (S27 lane A, R3.16, O-301,
 * O-26). The unit tests, the Playwright mocked api (e2e/support/mock-prediction.ts) and the shots
 * read these, so they agree on every shape.
 *
 * Mechanism: one prompt per answer kind, in the order a session alternates the two ladders (range
 * level 1, hand level 1, range level 2, hand level 2, range level 3, hand level 3), at a synthetic
 * big blind facing a button open with two raise sizes, so the size question has two answers. Each
 * prompt has a fixed truth; fixturePredictionResult judges an answer against it with the api's
 * rules. The range level 1 window holds 17 of 19 correct, so a right answer there is the 18th of 20
 * and unlocks level 2: the result view's unlock banner has a fixture. Every number is test data
 * chosen here: nothing is a real solution and nothing comes from any reference tool (O-26).
 */
import type { NodeAction, PracticeSession, PredictionPrompt, PredictionResult } from "../contracts.js";
import type { PredictionAnswer, PredictionKind } from "../prediction/types.js";
import type { Drill } from "../trainer/session-types.js";
import { FIXTURE_DRILL_ID, fixtureDrill } from "./trainer.js";

export const FIXTURE_PREDICTION_SESSION_ID = "00000000-0000-4000-8000-000000000160";
export const FIXTURE_PREDICTION_DRILL_ID = FIXTURE_DRILL_ID;
const FIXTURE_PREDICTION_SPOT_CLASS = "synthetic-facing-open-bb";
const FIXTURE_PREDICTION_NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const STARTED_AT = "2026-10-27T12:00:00Z";
const PROMPT_ID_PREFIX = "00000000-0000-8000-8000-0000000001";
const WINDOW_SIZE = 20;
const REQUIRED_PCT = 90;
const PERCENT_TOLERANCE = 2.5;
/** The fixture windows before an answer: 17 of 19 on range level 1 (one right answer unlocks), 6 of 8 elsewhere. */
const UNLOCKING_WINDOW = { answers: 19, correct: 17 } as const;
const OTHER_WINDOW = { answers: 8, correct: 6 } as const;

type Truth = PredictionResult["truth"];

export const fixturePredictionActions: readonly NodeAction[] = [
  { index: 0, token: "f", kind: "fold", size_cbb: 0, bucket: null, label: "Fold", next_node_key: null },
  { index: 1, token: "c", kind: "call", size_cbb: 250, bucket: null, label: "Call", next_node_key: null },
  { index: 2, token: "r1000", kind: "raise", size_cbb: 1000, bucket: null, label: "Raise to 10bb", next_node_key: null },
  { index: 3, token: "r2500", kind: "raise", size_cbb: 2500, bucket: null, label: "Raise to 25bb", next_node_key: null },
];

export const fixturePredictionSession: PracticeSession = {
  session_id: FIXTURE_PREDICTION_SESSION_ID,
  mode: "prediction",
  drill_id: FIXTURE_PREDICTION_DRILL_ID,
  state: "await_hero",
  state_version: 0,
  started_at: STARTED_AT,
  // S31: a practice session is never rated and carries no automated block or holdout progress.
  rated_eligible: false,
  automated: null,
  holdout: null,
};

/** The drill list the picker reads (GET /drills). */
export const fixtureDrillList: { items: Drill[]; next_cursor: string | null } = { items: [fixtureDrill], next_cursor: null };

const BASE: Omit<PredictionPrompt, "prompt_id" | "ladder" | "level" | "answer_kind" | "question" | "hand"> = {
  session_id: FIXTURE_PREDICTION_SESSION_ID,
  state_version: 0,
  spot_class_key: FIXTURE_PREDICTION_SPOT_CLASS,
  node_key: FIXTURE_PREDICTION_NODE_KEY,
  hero_position: "BB",
  history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
  actions: [...fixturePredictionActions],
  action_index: null,
  threshold_pct: null,
  regions: null,
  bands: null,
  synthetic: true,
};

const NO_TRUTH: Truth = { text: "", share_pct: null, frequency_pct: null, action_indexes: null, regions: null, band: null };

export interface FixturePrediction {
  prompt: PredictionPrompt;
  truth: Truth;
}

function prompt(order: number, fields: Partial<PredictionPrompt> & Pick<PredictionPrompt, "ladder" | "level" | "answer_kind" | "question">): PredictionPrompt {
  return { ...BASE, hand: null, ...fields, prompt_id: `${PROMPT_ID_PREFIX}${order.toString(16).padStart(2, "0")}` };
}

/** The six fixture prompts with their truths, in session order. */
export const fixturePredictions: readonly FixturePrediction[] = [
  {
    prompt: prompt(0, { ladder: "range", level: 1, answer_kind: "yes_no", question: "Does BB take Call with more than 30 percent of its range?", action_index: 1, threshold_pct: 30 }),
    truth: { ...NO_TRUTH, text: "BB takes Call with 38.4 percent of its range.", share_pct: 38.4, action_indexes: [1] },
  },
  {
    prompt: prompt(1, { ladder: "hand", level: 1, answer_kind: "action", question: "What does BB do most often with A5s?", hand: "A5s" }),
    truth: { ...NO_TRUTH, text: "BB plays A5s most often as Raise to 10bb (61.0 percent).", frequency_pct: 61, action_indexes: [2] },
  },
  {
    prompt: prompt(2, { ladder: "range", level: 2, answer_kind: "percent", question: "What share of BB's range takes Call? Answer to the nearest 5 percent.", action_index: 1 }),
    truth: { ...NO_TRUTH, text: "BB takes Call with 38.4 percent of its range.", share_pct: 38.4, action_indexes: [1] },
  },
  {
    prompt: prompt(3, { ladder: "hand", level: 2, answer_kind: "band", question: "How often does BB take Call with 55?", hand: "55", action_index: 1, bands: ["0_25", "25_50", "50_75", "75_100"] }),
    truth: { ...NO_TRUTH, text: "BB takes Call with 55 52.0 percent of the time.", frequency_pct: 52, action_indexes: [1], band: "50_75" },
  },
  {
    prompt: prompt(4, {
      ladder: "range",
      level: 3,
      answer_kind: "regions",
      question: "Which hand regions hold a class BB mixes between two or more actions?",
      regions: ["pairs", "suited_aces", "suited_broadways", "suited_connectors", "suited_other", "offsuit_aces", "offsuit_broadways", "offsuit_other"],
    }),
    truth: { ...NO_TRUTH, text: "BB mixes classes in: pairs, suited aces, suited connectors.", regions: ["pairs", "suited_aces", "suited_connectors"] },
  },
  {
    prompt: prompt(5, { ladder: "hand", level: 3, answer_kind: "size", question: "Which size does BB raise with most often with AKs?", hand: "AKs" }),
    truth: { ...NO_TRUTH, text: "BB's most frequent size with AKs is Raise to 25bb (70.0 percent).", frequency_pct: 70, action_indexes: [3] },
  },
];

/** The fixture prompt of one kind. */
export function fixturePredictionPrompt(kind: PredictionKind): PredictionPrompt {
  const found = fixturePredictions.find((entry) => entry.prompt.answer_kind === kind);
  if (found === undefined) throw new RangeError(`no fixture prompt asks for ${kind}`);
  return found.prompt;
}

/** The api's comparison rules (O-301) applied to a fixture truth; the mock's stand-in for judging. */
export function judgeFixture(truth: Truth, answer: PredictionAnswer, threshold: number | null): boolean {
  switch (answer.kind) {
    case "yes_no":
      return ((truth.share_pct ?? 0) > (threshold ?? 0)) === answer.value;
    case "percent":
      return Math.abs(answer.value - (truth.share_pct ?? 0)) <= PERCENT_TOLERANCE;
    case "regions":
      return answer.value.length === (truth.regions ?? []).length && answer.value.every((region) => (truth.regions ?? []).includes(region));
    case "action":
    case "size":
      return (truth.action_indexes ?? []).includes(answer.action_index);
    case "band":
      return answer.band === truth.band;
  }
}

function unlocks(entry: FixturePrediction): boolean {
  return entry.prompt.ladder === "range" && entry.prompt.level === 1;
}

function windowAfter(entry: FixturePrediction, correct: boolean): PredictionResult["window"] {
  const before = unlocks(entry) ? UNLOCKING_WINDOW : OTHER_WINDOW;
  return { answers: before.answers + 1, correct: before.correct + (correct ? 1 : 0), size: WINDOW_SIZE, required_pct: REQUIRED_PCT };
}

/** The result of answering a fixture prompt at a state version, judged against its truth. */
export function fixturePredictionResult(entry: FixturePrediction, answer: PredictionAnswer, stateVersion: number): PredictionResult {
  const correct = judgeFixture(entry.truth, answer, entry.prompt.threshold_pct);
  const unlocked = correct && unlocks(entry);
  return {
    prompt_id: entry.prompt.prompt_id,
    correct,
    ladder: entry.prompt.ladder,
    level: entry.prompt.level,
    truth: entry.truth,
    window: windowAfter(entry, correct),
    next_level_unlocked: unlocked,
    new_level: unlocked ? entry.prompt.level + 1 : entry.prompt.level,
    state_version: stateVersion + 1,
  };
}
