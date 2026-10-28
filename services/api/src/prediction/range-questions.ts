/**
 * The range ladder's questions (R3.16, O-301, plan decision 6, ADR 0004).
 *
 * The ladder asks about the acting seat's whole range at the node:
 * - level 1 (yes_no): "Does <seat> take <action> with more than T percent of its range?" The action
 *   is the non-fold action with the largest share in solver-query's range summary (ties: the lowest
 *   index). T is a multiple of THRESHOLD_STEP_PCT drawn with the session's seeded generator among
 *   the multiples within THRESHOLD_SPREAD_PCT points of the truth, clamped to THRESHOLD_MIN_PCT to
 *   THRESHOLD_MAX_PCT. Correct when (share > T) equals the answer.
 * - level 2 (percent): the same action's share; correct within PERCENT_TOLERANCE_PCT points.
 * - level 3 (regions): which named regions (regions.ts) hold a class the seat holds with
 *   solver-query's mixed flag; correct on the exact set. It needs the 169-class hand space; a node
 *   of combos falls back to level 2.
 * The truth share is Rust's share in percent; nothing is summed or estimated here.
 */
import { pickIndex } from "../sessions/randomness.js";
import type { SqNode } from "../solver-query/client.js";
import {
  PERCENT,
  actionLabel,
  formatPct,
  heldRows,
  type PredictionQuestion,
  type QuestionInput,
} from "./question.js";
import { HAND_REGIONS, regionsHolding } from "./regions.js";

/** The yes or no threshold is a multiple of this many percent (O-301). */
export const THRESHOLD_STEP_PCT = 5;
/** The threshold lies within this many points of the truth (O-301). */
export const THRESHOLD_SPREAD_PCT = 15;
export const THRESHOLD_MIN_PCT = 5;
export const THRESHOLD_MAX_PCT = 95;
/** A level 2 answer is correct within this many points of the truth (O-301). */
export const PERCENT_TOLERANCE_PCT = 2.5;

const LEVEL_THRESHOLD = 1;
const LEVEL_PERCENT = 2;
const LEVEL_REGIONS = 3;
const CLASS_SPACE = "preflop_169";
const FOLD = "fold";

interface TargetShare {
  index: number;
  sharePct: number;
}

/** The non-fold action with the largest share of the range (ties: lowest index); undefined when none. */
export function targetShare(node: SqNode): TargetShare | undefined {
  let best: TargetShare | undefined;
  for (const action of node.actions) {
    const share = node.range_summary.by_action.find((entry) => entry.index === action.index)?.share;
    if (action.kind === FOLD || share === undefined) {
      continue;
    }
    if (best === undefined || share * PERCENT > best.sharePct) {
      best = { index: action.index, sharePct: share * PERCENT };
    }
  }
  return best;
}

/** The thresholds a level 1 question may ask, ascending. */
export function thresholdChoices(sharePct: number): number[] {
  const choices: number[] = [];
  for (let threshold = THRESHOLD_MIN_PCT; threshold <= THRESHOLD_MAX_PCT; threshold += THRESHOLD_STEP_PCT) {
    if (Math.abs(threshold - sharePct) <= THRESHOLD_SPREAD_PCT) {
      choices.push(threshold);
    }
  }
  return choices;
}

function shareTruthText(node: SqNode, target: TargetShare): string {
  return `${node.to_act} takes ${actionLabel(node, target.index)} with ${formatPct(target.sharePct)} of its range.`;
}

function base(level: number, target: TargetShare | null) {
  return {
    ladder: "range" as const,
    level,
    hand: null,
    action_index: target?.index ?? null,
    threshold_pct: null,
    regions: null,
    bands: null,
  };
}

function shareTruth(node: SqNode, target: TargetShare): PredictionQuestion["truth"] {
  return {
    text: shareTruthText(node, target),
    share_pct: target.sharePct,
    frequency_pct: null,
    action_indexes: [target.index],
    regions: null,
    band: null,
  };
}

function thresholdQuestion(input: QuestionInput, target: TargetShare): PredictionQuestion {
  const choices = thresholdChoices(target.sharePct);
  const threshold = choices[pickIndex(input.draws.threshold, choices.length)] ?? THRESHOLD_MIN_PCT;
  const label = actionLabel(input.node, target.index);
  return {
    ...base(LEVEL_THRESHOLD, target),
    answer_kind: "yes_no",
    question: `Does ${input.node.to_act} take ${label} with more than ${threshold} percent of its range?`,
    threshold_pct: threshold,
    truth: shareTruth(input.node, target),
  };
}

function percentQuestion(input: QuestionInput, target: TargetShare): PredictionQuestion {
  const label = actionLabel(input.node, target.index);
  return {
    ...base(LEVEL_PERCENT, target),
    answer_kind: "percent",
    question: `What share of ${input.node.to_act}'s range takes ${label}? Answer to the nearest ${THRESHOLD_STEP_PCT} percent.`,
    truth: shareTruth(input.node, target),
  };
}

function regionsTruthText(node: SqNode, regions: readonly string[]): string {
  return regions.length === 0
    ? `${node.to_act} plays every class it holds here with one action.`
    : `${node.to_act} mixes classes in: ${regions.map((region) => region.replaceAll("_", " ")).join(", ")}.`;
}

function regionsQuestion(input: QuestionInput): PredictionQuestion {
  const mixed = heldRows(input.node).filter((row) => row.mixed);
  const regions = regionsHolding(mixed.map((row) => row.hand));
  return {
    ...base(LEVEL_REGIONS, null),
    answer_kind: "regions",
    question: `Which hand regions hold a class ${input.node.to_act} mixes between two or more actions?`,
    regions: [...HAND_REGIONS],
    truth: { text: regionsTruthText(input.node, regions), share_pct: null, frequency_pct: null, action_indexes: null, regions, band: null },
  };
}

/** The range ladder's question at the input's level; undefined when the node has no non-fold action. */
export function rangeQuestion(input: QuestionInput): PredictionQuestion | undefined {
  if (input.level === LEVEL_REGIONS && input.node.hand_space === CLASS_SPACE) {
    return regionsQuestion(input);
  }
  const target = targetShare(input.node);
  if (target === undefined) {
    return undefined;
  }
  return input.level === LEVEL_THRESHOLD ? thresholdQuestion(input, target) : percentQuestion(input, target);
}
