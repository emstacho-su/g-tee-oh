/**
 * Synthetic range-painting fixtures typed against the api contract (S27 lane B, R3.17, O-300,
 * O-26). The unit tests, the Playwright mocked api (e2e/support/mock-paint.ts) and the shots read
 * these, so they agree on every shape.
 *
 * Mechanism: the prompt is the big blind facing a button open with three brushes (fold, call,
 * raise) over every grid class except a handful of the weakest offsuit hands, which the node does
 * not hold, so the painter shows disabled cells. fixturePaintResult grades any paint of the prompt
 * by a fixed formula from the class's grid position: a class's best action falls with the grid
 * distance from AA, its loss grows with the distance between the painted and best action, and its
 * weight is its combos over the held combos. Every number is generated here as test data: nothing
 * is a real solution, nothing comes from any reference tool (O-26), and the web app itself never
 * computes these (ADR 0004); it only shows what the api (here, the mock) answers.
 */
import type { NodeAction, RangePaintPrompt, RangePaintResult } from "../contracts.js";
import type { Drill, PracticeSession } from "../trainer/session-types.js";
import { GRID_SIZE, HAND_GRID } from "../poker/hands.js";
import { fixtureDrill } from "./trainer.js";

export const FIXTURE_PAINT_SESSION_ID = "00000000-0000-4000-8000-000000000270";
export const FIXTURE_PAINT_DRILL_ID = "00000000-0000-4000-8000-000000000272";
const FIXTURE_PAINT_SOLUTION_ID = "00000000-0000-4000-8000-000000000271";
export const FIXTURE_PAINT_NODE_KEY = "cfg_6_online_100/BB-BTN/r250";
const FIXTURE_PAINT_SPOT_CLASS = "synthetic-facing-open-bb";
/** The classes the synthetic node does not hold, so the painter shows "not in range" cells. */
export const FIXTURE_PAINT_ABSENT = ["72o", "62o", "52o", "42o", "32o", "82o", "43o"] as const;
const FIXTURE_FLOOR_PCT_POT = 0.5;
const FIXTURE_PAINT_TIME = "2026-10-28T12:00:00Z";

/** A synthetic drill training the big blind facing a button open, the spot the prompt paints. */
export const fixturePaintDrill: Drill = {
  ...fixtureDrill,
  id: FIXTURE_PAINT_DRILL_ID,
  name: "Big blind defends against the button (synthetic)",
  spot_filter: { ...fixtureDrill.spot_filter, hero_positions: ["BB"], villain_positions: ["BTN"], preflop_action: ["vs_open"] },
  created_at: FIXTURE_PAINT_TIME,
  updated_at: FIXTURE_PAINT_TIME,
};

/** The drills the picker lists: the painting drill first, then the trainer fixture drill. */
export const fixturePaintDrills: readonly Drill[] = [fixturePaintDrill, fixtureDrill];

export const fixturePaintSession: PracticeSession = {
  session_id: FIXTURE_PAINT_SESSION_ID,
  mode: "range_paint",
  drill_id: FIXTURE_PAINT_DRILL_ID,
  state: "await_hero",
  state_version: 0,
  started_at: FIXTURE_PAINT_TIME,
  // S31: a practice session is never rated and carries no automated block or holdout progress.
  rated_eligible: false,
  automated: null,
  holdout: null,
};

export const fixturePaintActions: readonly NodeAction[] = [
  { index: 0, token: "f", kind: "fold", size_cbb: null, bucket: null, label: "Fold", next_node_key: null },
  { index: 1, token: "c", kind: "call", size_cbb: null, bucket: null, label: "Call", next_node_key: null },
  { index: 2, token: "r1000", kind: "raise", size_cbb: 1000, bucket: "pot", label: "Raise to 10bb", next_node_key: null },
];

const ABSENT: ReadonlySet<string> = new Set(FIXTURE_PAINT_ABSENT);

export const fixturePaintPrompt: RangePaintPrompt = {
  session_id: FIXTURE_PAINT_SESSION_ID,
  state_version: 0,
  prompt_no: 0,
  solution_id: FIXTURE_PAINT_SOLUTION_ID,
  node_key: FIXTURE_PAINT_NODE_KEY,
  spot_class_key: FIXTURE_PAINT_SPOT_CLASS,
  hero_position: "BB",
  history: [{ position: "BTN", token: "r250", label: "Raise to 2.5bb" }],
  actions: [...fixturePaintActions],
  hands: HAND_GRID.filter((cell) => !ABSENT.has(cell.hand)).map((cell) => cell.hand),
  synthetic: true,
};

const STRENGTH_SCALE = 2 * (GRID_SIZE - 1);
const RAISE_STRENGTH = 0.72;
const CALL_STRENGTH = 0.42;
const BASE_LOSS_BB = 0.05;
const LOSS_SLOPE_BB = 3;
const POT_BB = 4;
const PERCENT = 100;
const FOLD = 0;
const CALL = 1;
const RAISE = 2;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function strengthOf(row: number, col: number): number {
  return 1 - (row + col) / STRENGTH_SCALE;
}

function bestOf(strength: number): number {
  if (strength >= RAISE_STRENGTH) return RAISE;
  return strength >= CALL_STRENGTH ? CALL : FOLD;
}

const HELD_CELLS = HAND_GRID.filter((cell) => !ABSENT.has(cell.hand));
const HELD_COMBOS = HELD_CELLS.reduce((total, cell) => total + cell.combos, 0);

type HandGrade = RangePaintResult["per_hand"][number];

function gradeOf(hand: string, actionIndex: number): HandGrade {
  const cell = HELD_CELLS.find((candidate) => candidate.hand === hand);
  if (cell === undefined) throw new RangeError(`the fixture node does not hold ${hand}`);
  const strength = strengthOf(cell.row, cell.col);
  const best = bestOf(strength);
  const steps = Math.abs(actionIndex - best);
  const lossBb = steps === 0 ? 0 : round(steps * (BASE_LOSS_BB + Math.abs(strength - CALL_STRENGTH) * LOSS_SLOPE_BB), 4);
  const weight = round(cell.combos / HELD_COMBOS, 6);
  return {
    hand,
    action_index: actionIndex,
    best_action_index: best,
    loss_bb: lossBb,
    loss_pct_pot: round((lossBb / POT_BB) * PERCENT, 2),
    weight,
    weighted_loss_bb: round(lossBb * weight, 6),
  };
}

/** The synthetic grade of a paint of fixturePaintPrompt: per class in the prompt's order, and the sum. */
export function fixturePaintResult(paint: Readonly<Record<string, number>>, stateVersion = 1): RangePaintResult {
  const perHand = fixturePaintPrompt.hands.map((hand) => gradeOf(hand, paint[hand] ?? FOLD));
  return {
    session_id: FIXTURE_PAINT_SESSION_ID,
    state_version: stateVersion,
    node_key: FIXTURE_PAINT_NODE_KEY,
    floor_pct_pot: FIXTURE_FLOOR_PCT_POT,
    total_weighted_loss_bb: round(
      perHand.reduce((total, row) => total + row.weighted_loss_bb, 0),
      6,
    ),
    per_hand: perHand,
  };
}

/** A paint with every class at its best action, except the classes in `wrong` painted with the given index. */
export function fixtureBestPaint(wrong: Readonly<Record<string, number>> = {}): Record<string, number> {
  return Object.fromEntries(
    fixturePaintPrompt.hands.map((hand) => [hand, wrong[hand] ?? gradeOf(hand, FOLD).best_action_index]),
  );
}

/** A paint a player might make: the best paint with a few strong hands flatted and a weak hand raised. */
export const FIXTURE_PAINT_MISTAKES: Readonly<Record<string, number>> = { AKo: CALL, QQ: CALL, T9s: RAISE, K2o: RAISE, "65s": RAISE };

export const fixturePaintGraded: RangePaintResult = fixturePaintResult(fixtureBestPaint(FIXTURE_PAINT_MISTAKES));
