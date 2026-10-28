/**
 * The hand ladder's questions (R3.16, O-301, plan decision 6, ADR 0004).
 *
 * The hand is a class the acting seat holds at the node (reach above 0, or none recorded), drawn
 * with the session's seeded generator. Then:
 * - level 1 (action): the hand's highest-EV action. An answer is correct when its loss is at or
 *   below the node's floor, what grading labels Best or Correct (O-379); the reveal names the
 *   lowest-loss action or actions (learning's lowestLossIndexes, the one tie rule, O-370), each with
 *   its solver frequency, then the other correct actions with theirs, leaving that clause out when
 *   there are none (ADR 0024 consequence 2, O-374, PR #39 review finding 4). Levels 2 and 3 ask
 *   about frequency by their wording and keep the frequency rule.
 * - level 2 (band): the band (0 to 25, 25 to 50, 50 to 75, 75 to 100 percent; lower edge
 *   inclusive, 100 in the top band) of the hand's most frequent action (lowest index on a tie).
 * - level 3 (size): asked only when the node has two or more aggressive actions (bet, raise, all
 *   in) and the hand plays one at SIZE_MIN_FREQUENCY or more; the aggressive action it plays most
 *   is correct (ties within the tolerance too). Otherwise the prompt falls back to level 2, except in
 *   a quiz (exactLevel), which tries the other held hands and never falls back (O-411 amended).
 * Every frequency and loss is solver-query's; only comparisons happen here (ADR 0004).
 */
import { FREQUENCY_TIE_TOLERANCE, lowestLossIndexes } from "@g-tee-oh/learning";

import { pickIndex } from "../sessions/randomness.js";
import type { SqNode } from "../solver-query/client.js";
import {
  PERCENT,
  actionLabel,
  formatPct,
  frequencyOf,
  heldRows,
  isAggressive,
  lossOf,
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

/** The indexes whose loss is the row's lowest within learning's tie tolerance: the highest EV (O-374, O-370). */
export function highestEvIndexes(row: SqHandRow, indexes: readonly number[]): number[] {
  const positions = lowestLossIndexes(indexes.map((index) => lossOf(row, index)));
  return indexes.filter((_, position) => positions.includes(position));
}

/** The indexes a level 1 answer may name: the highest EV and every action at or below the floor (O-379). */
export function correctActionIndexes(row: SqHandRow, indexes: readonly number[], floorPctPot: number, best: readonly number[]): number[] {
  return indexes.filter((index) => best.includes(index) || lossOf(row, index) <= floorPctPot);
}

function base(level: number, row: SqHandRow) {
  return { ladder: "hand" as const, level, hand: row.hand, action_index: null, threshold_pct: null, regions: null, bands: null };
}

function labels(node: SqNode, indexes: readonly number[]): string {
  return indexes.map((index) => actionLabel(node, index)).join(" or ");
}

/** "Raise to 10bb (30.0 percent)": an action with the solver's frequency for the row. */
function withFrequency(node: SqNode, row: SqHandRow, index: number): string {
  return `${actionLabel(node, index)} (${formatPct(frequencyOf(row, index) * PERCENT)})`;
}

/**
 * The level 1 reveal (O-379, PR #39 review finding 4): the best (lowest-loss) action or actions, each
 * with its solver frequency, then the other correct actions (at or below the floor) with theirs,
 * never repeating a best one; the second clause is left out when there are none.
 */
function actionReveal(node: SqNode, row: SqHandRow, correct: readonly number[], best: readonly number[]): string {
  const named = best.map((index) => withFrequency(node, row, index)).join(" or ");
  const others = correct.filter((index) => !best.includes(index));
  const head = `${node.to_act}'s highest-EV action with ${row.hand} is ${named}.`;
  if (others.length === 0) {
    return head;
  }
  return `${head} Within the noise floor, so also correct: ${others.map((index) => withFrequency(node, row, index)).join(", ")}.`;
}

function actionQuestion(node: SqNode, row: SqHandRow): PredictionQuestion {
  const indexes = node.actions.map((action) => action.index);
  const best = highestEvIndexes(row, indexes);
  const correct = correctActionIndexes(row, indexes, node.floor_pct_pot, best);
  const frequencyPct = best.reduce((sum, index) => sum + frequencyOf(row, index), 0) * PERCENT;
  return {
    ...base(LEVEL_ACTION, row),
    answer_kind: "action",
    question: `What is ${node.to_act}'s highest-EV action with ${row.hand}?`,
    truth: {
      text: actionReveal(node, row, correct, best),
      share_pct: null,
      frequency_pct: frequencyPct,
      action_indexes: correct,
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

/**
 * The exact level 3 of a quiz (O-411 amended, PR #39 review finding 2): the size question of the
 * drawn hand, else of the next held hand that can ask one, in held order from the draw (so the prompt
 * stays a function of the draw); undefined when no held hand can.
 */
function exactSizeQuestion(node: SqNode, held: readonly SqHandRow[], start: number): PredictionQuestion | undefined {
  for (let offset = 0; offset < held.length; offset += 1) {
    const row = held[(start + offset) % held.length];
    const question = row === undefined ? undefined : sizeQuestion(node, row);
    if (question !== undefined) {
      return question;
    }
  }
  return undefined;
}

/**
 * The hand ladder's question at the input's level; undefined when the seat holds no class here, or,
 * at an exact level 3, when no held hand can ask the size question.
 */
export function handQuestion(input: QuestionInput): PredictionQuestion | undefined {
  const held = heldRows(input.node).filter((row) => row.strategy.length > 0);
  if (held.length === 0) {
    return undefined;
  }
  const start = pickIndex(input.draws.hand, held.length);
  const row = held[start];
  if (row === undefined) {
    return undefined;
  }
  if (input.level === LEVEL_SIZE) {
    return input.exactLevel === true ? exactSizeQuestion(input.node, held, start) : (sizeQuestion(input.node, row) ?? bandQuestion(input.node, row));
  }
  return input.level === LEVEL_ACTION ? actionQuestion(input.node, row) : bandQuestion(input.node, row);
}
