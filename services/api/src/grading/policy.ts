/**
 * The learning policy's input for one decision (R3.7, A6 section 4, ADR 0004, O-210, O-212, O-213).
 *
 * Mechanism: every number comes from solver-query: the hand's frequencies, the per-action loss in
 * percent of the pot (loss_pct_pot_by_action, O-210), the floor and the noise flags from
 * /v1/grade, the actions' kinds, buckets and sizes from the node. The api only pairs them up and
 * validates them (a list of another length, an unknown kind or bucket is a 502, since the upstream
 * answered something the policy cannot read). Drill mode is never rated (05 section 1), and a
 * decision is a first attempt because each state version is graded once (O-246).
 *
 * Panels that reveal the answer: the hero's strategy matrix, the action frequency table and the
 * threshold card each show which action the hand takes before the hero acts; the range matrices,
 * charts, hand class, breakdowns, roller and streak counter do not.
 *
 * best_action_indexes is the actions tied for the hand's highest frequency within learning's
 * FREQUENCY_TIE_TOLERANCE (O-212), or in RNG mode the one action the roll selects
 * (rollSelectedAction, O-213), the same rule grade() uses for Best.
 */
import {
  ACTION_KINDS,
  BUCKETS,
  FREQUENCY_TIE_TOLERANCE,
  rollSelectedAction,
  type ActionKind,
  type Bucket,
  type GradeAction,
  type GradeInput,
  type Street,
} from "@g-tee-oh/learning";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { PANEL_KEYS, TrainerSettings } from "../schemas/drills.js";
import type { SqGrade, SqNode } from "../solver-query/client.js";

export const ANSWER_REVEALING_PANELS: readonly (typeof PANEL_KEYS)[number][] = [
  "hero_strategy_matrix",
  "action_frequency_table",
  "threshold_card",
];

const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

export interface GradeInputFacts {
  node: SqNode;
  grade: SqGrade;
  actionIndex: number;
  rngRoll: number | null;
  settings: TrainerSettings;
  ratedTodayInTrack: number;
}

function unreadable(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, { detail });
}

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw unreadable(`solver-query answered an unknown ${what}.`);
  }
  return found;
}

export function panelsRevealAnswer(settings: TrainerSettings): boolean {
  return ANSWER_REVEALING_PANELS.some((panel) => settings.panels[panel] === true);
}

/** The node's actions with the hand's loss for each, in record order (O-210). */
export function gradeActions(node: SqNode, grade: SqGrade): GradeAction[] {
  const losses = grade.loss_pct_pot_by_action;
  if (losses.length !== node.actions.length || grade.freq_by_action.length !== node.actions.length) {
    throw unreadable("solver-query answered per-action lists that do not match the node's actions.");
  }
  return node.actions.map((action, index) => ({
    kind: oneOf<ActionKind>(action.kind, ACTION_KINDS, "action kind"),
    bucket: action.bucket === null || action.bucket === undefined ? null : oneOf<Bucket>(action.bucket, BUCKETS, "bucket"),
    sizeCbb: action.size_cbb,
    lossPctPot: losses[index] ?? Number.NaN,
  }));
}

export function bestActionIndexes(freqByAction: readonly number[], actions: readonly GradeAction[], rngRoll: number | null): number[] {
  if (rngRoll !== null) {
    return [rollSelectedAction(freqByAction, actions, rngRoll)];
  }
  const top = Math.max(...freqByAction);
  return freqByAction.flatMap((frequency, index) => (top - frequency <= FREQUENCY_TIE_TOLERANCE ? [index] : []));
}

/** The GradeInput of one drill decision; the chosen loss is the per-action list's entry (O-210). */
export function buildGradeInput(facts: GradeInputFacts): GradeInput {
  const { node, grade, actionIndex, rngRoll, settings } = facts;
  const actions = gradeActions(node, grade);
  return {
    lossPctPot: actions[actionIndex]?.lossPctPot ?? Number.NaN,
    floorPctPot: grade.floor_pct_pot,
    freqByAction: [...grade.freq_by_action],
    actionIndex,
    ...(rngRoll === null ? {} : { rngRoll }),
    noiseFlags: [...grade.noise_flags],
    mode: "drill",
    firstAttempt: true,
    panelsRevealed: panelsRevealAnswer(settings),
    grouping: settings.grouping,
    actions,
    ratedTodayInTrack: facts.ratedTodayInTrack,
    street: oneOf<Street>(node.street, STREETS, "street"),
  };
}
