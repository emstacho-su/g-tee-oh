/**
 * The hand ladder's questions (R3.16, O-301, plan decision 6, ADR 0004).
 *
 * The hand is a class the acting seat holds at the node (reach above 0, or none recorded), drawn
 * with the session's seeded generator. Then:
 * - level 1 (action): the hand's most frequent action; every action within learning's
 *   FREQUENCY_TIE_TOLERANCE of the top frequency is correct.
 * - level 2 (band): the band (0 to 25, 25 to 50, 50 to 75, 75 to 100 percent; lower edge
 *   inclusive, 100 in the top band) of the hand's most frequent action (lowest index on a tie).
 * - level 3 (size): asked only when the node has two or more aggressive actions (bet, raise, all
 *   in) and the hand plays one at SIZE_MIN_FREQUENCY or more; the aggressive action it plays most
 *   is correct (ties within the tolerance too). Otherwise the prompt falls back to level 2.
 * Every frequency is solver-query's strategy; only comparisons happen here.
 */
import { FREQUENCY_TIE_TOLERANCE } from "@g-tee-oh/learning";

import { pickIndex } from "../sessions/randomness.js";
import type { SqNode } from "../solver-query/client.js";
import {
  PERCENT,
  actionLabel,
  formatPct,
  frequencyOf,
  heldRows,
  isAggressive,
  type FrequencyBand,
  type PredictionQuestion,
  type QuestionInput,
  type SqHandRow,
} from "./question.js";

/** The bands of level 2 with their lower edges in percent, ascending (O-301). */
export const FREQUENCY_BANDS: readonly { band: FrequencyBand; fromPct: number }[] = [
  { band: "0_25", fromPct: 0 },
  { band: "25_50", fromPct: 25 },
  { band: "50_75", fromPct: 50 },
  { band: "75_100", fromPct: 75 },
];
/** The size question needs the hand to play an aggressive action at least this often (O-301). */
export const SIZE_MIN_FREQUENCY = 0.05;
/** The size question needs at least this many aggressive actions at the node. */
export const SIZE_MIN_AGGRESSIVE_ACTIONS = 2;

const LEVEL_ACTION = 1;
const LEVEL_BAND = 2;
const LEVEL_SIZE = 3;

/** The band holding a frequency in percent: lower edge inclusive, so 100 is in the top band. */
export function bandOf(frequencyPct: number): FrequencyBand {
  let found: FrequencyBand = "0_25";
  for (const entry of FREQUENCY_BANDS) {
    if (frequencyPct >= entry.fromPct) {
      found = entry.band;
    }
  }
  return found;
}

/** The indexes among `indexes` whose frequency is the top one within the tie tolerance. */
export function topIndexes(row: SqHandRow, indexes: readonly number[]): number[] {
  const top = Math.max(...indexes.map((index) => frequencyOf(row, index)));
  return indexes.filter((index) => top - frequencyOf(row, index) <= FREQUENCY_TIE_TOLERANCE);
}

function base(level: number, row: SqHandRow) {
  return { ladder: "hand" as const, level, hand: row.hand, action_index: null, threshold_pct: null, regions: null, bands: null };
}

function labels(node: SqNode, indexes: readonly number[]): string {
  return indexes.map((index) => actionLabel(node, index)).join(" or ");
}

function actionQuestion(node: SqNode, row: SqHandRow): PredictionQuestion {
  const best = topIndexes(row, node.actions.map((action) => action.index));
  const frequencyPct = frequencyOf(row, best[0] ?? 0) * PERCENT;
  return {
    ...base(LEVEL_ACTION, row),
    answer_kind: "action",
    question: `What does ${node.to_act} do most often with ${row.hand}?`,
    truth: {
      text: `${node.to_act} plays ${row.hand} most often as ${labels(node, best)} (${formatPct(frequencyPct)}).`,
      share_pct: null,
      frequency_pct: frequencyPct,
      action_indexes: best,
      regions: null,
      band: null,
    },
  };
}

function bandQuestion(node: SqNode, row: SqHandRow): PredictionQuestion {
  const index = topIndexes(row, node.actions.map((action) => action.index))[0] ?? 0;
  const frequencyPct = frequencyOf(row, index) * PERCENT;
  const label = actionLabel(node, index);
  const band = bandOf(frequencyPct);
  return {
    ...base(LEVEL_BAND, row),
    answer_kind: "band",
    question: `How often does ${node.to_act} take ${label} with ${row.hand}?`,
    action_index: index,
    bands: FREQUENCY_BANDS.map((entry) => entry.band),
    truth: {
      text: `${node.to_act} takes ${label} with ${row.hand} ${formatPct(frequencyPct)} of the time.`,
      share_pct: null,
      frequency_pct: frequencyPct,
      action_indexes: [index],
      regions: null,
      band,
    },
  };
}

function sizeQuestion(node: SqNode, row: SqHandRow): PredictionQuestion | undefined {
  const aggressive = node.actions.filter(isAggressive).map((action) => action.index);
  const playsAggressive = aggressive.some((index) => frequencyOf(row, index) >= SIZE_MIN_FREQUENCY);
  if (aggressive.length < SIZE_MIN_AGGRESSIVE_ACTIONS || !playsAggressive) {
    return undefined;
  }
  const best = topIndexes(row, aggressive);
  const frequencyPct = frequencyOf(row, best[0] ?? 0) * PERCENT;
  return {
    ...base(LEVEL_SIZE, row),
    answer_kind: "size",
    question: `Which size does ${node.to_act} raise with most often with ${row.hand}?`,
    truth: {
      text: `${node.to_act}'s most frequent size with ${row.hand} is ${labels(node, best)} (${formatPct(frequencyPct)}).`,
      share_pct: null,
      frequency_pct: frequencyPct,
      action_indexes: best,
      regions: null,
      band: null,
    },
  };
}

/** The hand ladder's question at the input's level; undefined when the seat holds no class here. */
export function handQuestion(input: QuestionInput): PredictionQuestion | undefined {
  const held = heldRows(input.node).filter((row) => row.strategy.length > 0);
  if (held.length === 0) {
    return undefined;
  }
  const row = held[pickIndex(input.draws.hand, held.length)];
  if (row === undefined) {
    return undefined;
  }
  if (input.level === LEVEL_SIZE) {
    return sizeQuestion(input.node, row) ?? bandQuestion(input.node, row);
  }
  return input.level === LEVEL_ACTION ? actionQuestion(input.node, row) : bandQuestion(input.node, row);
}
