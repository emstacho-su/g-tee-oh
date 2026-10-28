/**
 * The learning policy's input for one decision (R3.7, A6 section 4, ADR 0004, ADR 0024, O-210, O-213).
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
 * best_action_indexes is learning's bestActionIndexes: the Best groups are the lowest-loss (highest
 * EV) groups under the session's grouping, within LOSS_TIE_TOLERANCE_PCT_POT and at or below the
 * floor, the same rule grade() labels Best by (ADR 0024 rules 1 and 4, O-343); from each Best group
 * only its lowest-loss member or members are listed, not every member (O-375 as amended in S37
 * review). A worse size of a Best type is still labelled Best by its group, but is not listed here.
 * The roll and the frequencies never enter it; the roll only sets grade()'s followedRoll mark
 * (rule 2, O-344).
 */
import {
  ACTION_KINDS,
  BUCKETS,
  bestActionIndexes as learningBestActionIndexes,
  type ActionKind,
  type Bucket,
  type GradeAction,
  type GradeInput,
  type GradeMode,
  type Grouping,
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
  /**
   * The grading mode, taken only from the server-side session row (gradeModeOf), never from a
   * request field, so a client can never make a drill decision rated (S27 PM review note 2).
   */
  mode: GradeMode;
}

/** The session modes that are graded decision by decision (prediction and range_paint never are, O-302). */
export type GradedSessionMode = "automated" | "drill" | "holdout";

/** The learning GradeMode of a session row's mode; a practice session never reaches grading. */
export function gradeModeOf(sessionMode: string): GradeMode {
  if (sessionMode === "automated" || sessionMode === "drill" || sessionMode === "holdout") {
    return sessionMode;
  }
  throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, {
    detail: `A ${sessionMode} session has no graded decisions (O-302).`,
  });
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

/** The node's street, as the policy spells it; an unknown street is a 502 (the upstream answered it). */
export function streetOf(node: SqNode): Street {
  return oneOf<Street>(node.street, STREETS, "street");
}

/** The best actions of the hand at the node under the grouping (ADR 0024 rule 4, O-375). */
export function bestActionIndexes(node: SqNode, grade: SqGrade, grouping: Grouping): number[] {
  return learningBestActionIndexes({
    actions: gradeActions(node, grade),
    grouping,
    street: streetOf(node),
    floorPctPot: grade.floor_pct_pot,
  });
}

/** The GradeInput of one decision; the chosen loss is the per-action list's entry (O-210). */
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
    mode: facts.mode,
    firstAttempt: true,
    panelsRevealed: panelsRevealAnswer(settings),
    grouping: settings.grouping,
    actions,
    ratedTodayInTrack: facts.ratedTodayInTrack,
    street: streetOf(node),
  };
}
