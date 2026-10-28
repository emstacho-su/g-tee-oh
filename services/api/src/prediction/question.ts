/**
 * The shape of one prediction question and the node facts both ladders read (R3.16, O-301, ADR
 * 0004). A question carries what the prompt shows and, server side only, its truth: the Rust
 * numbers and flags the answer is compared with (predict before peek, O-302). Nothing here
 * computes a poker number: shares, frequencies, reach and the mixed flag are solver-query's, and
 * the only arithmetic is the unit change of a 0 to 1 share into percent for display and comparison.
 */
import type { z } from "zod";

import type { frequencyBandSchema, predictionAnswerKindSchema, predictionLadderSchema } from "../schemas/prediction.js";
import type { SqNode } from "../solver-query/client.js";
import { upstreamInconsistent } from "../sessions/problems.js";
import type { HandRegion } from "./regions.js";

export type PredictionLadder = z.infer<typeof predictionLadderSchema>;
export type PredictionAnswerKind = z.infer<typeof predictionAnswerKindSchema>;
export type FrequencyBand = z.infer<typeof frequencyBandSchema>;
export type SqHandRow = SqNode["hands"][number];
export type SqNodeAction = SqNode["actions"][number];

/** A 0 to 1 share or frequency in percent. */
export const PERCENT = 100;
const PAIR_SEPARATOR = "-";
const PERCENT_DECIMALS = 1;
/** The action kinds that put chips in by choice: the size question compares only these (O-301). */
const AGGRESSIVE_KINDS: ReadonlySet<string> = new Set(["bet", "raise", "all_in"]);

/** The solver's answer, compared with the player's and shown after it (PredictionResult.truth). */
export interface QuestionTruth {
  text: string;
  share_pct: number | null;
  frequency_pct: number | null;
  action_indexes: number[] | null;
  regions: HandRegion[] | null;
  band: FrequencyBand | null;
}

export interface PredictionQuestion {
  ladder: PredictionLadder;
  level: number;
  answer_kind: PredictionAnswerKind;
  question: string;
  hand: string | null;
  action_index: number | null;
  threshold_pct: number | null;
  regions: HandRegion[] | null;
  bands: FrequencyBand[] | null;
  truth: QuestionTruth;
}

/** The seeded draws one prompt takes (derive.ts). */
export interface QuestionDraws {
  hand: bigint;
  threshold: bigint;
}

export interface QuestionInput {
  node: SqNode;
  level: number;
  draws: QuestionDraws;
  /**
   * A quiz asks exactly its level (O-411 amended, PR #39 review finding 2): a level 3 question the
   * node cannot ask is undefined instead of the level 2 fallback drill-backed sessions keep.
   */
  exactLevel?: boolean;
}

export function isAggressive(action: Pick<SqNodeAction, "kind">): boolean {
  return AGGRESSIVE_KINDS.has(action.kind);
}

/** A percent for a sentence, one decimal (formatting only). */
export function formatPct(value: number): string {
  return `${value.toFixed(PERCENT_DECIMALS)} percent`;
}

export function actionLabel(node: SqNode, index: number): string {
  const action = node.actions.find((entry) => entry.index === index);
  if (action === undefined) {
    throw upstreamInconsistent("solver-query named an action the node does not hold.");
  }
  return action.label;
}

/** The acting seat's place in the pair (reach is in pair order, out of position first). */
export function actingSeatIndex(node: SqNode): number {
  const index = node.pair.split(PAIR_SEPARATOR).indexOf(node.to_act);
  if (index < 0) {
    throw upstreamInconsistent("solver-query answered a node whose seat to act is not in its pair.");
  }
  return index;
}

/** The classes the acting seat holds at the node: reach above 0, or no reach recorded (O-301). */
export function heldRows(node: SqNode): SqHandRow[] {
  const seat = actingSeatIndex(node);
  return node.hands.filter((row) => {
    const reach = row.reach?.[seat];
    return reach === undefined || reach > 0;
  });
}

/** One row's loss for an action in percent of the pot, as solver-query gave it (0 for the best). */
export function lossOf(row: SqHandRow, index: number): number {
  const loss = row.loss_pct_pot[index];
  if (loss === undefined) {
    throw upstreamInconsistent("solver-query answered a hand row without a loss for every action.");
  }
  return loss;
}

/** One row's frequency of an action, as solver-query gave it. */
export function frequencyOf(row: SqHandRow, index: number): number {
  const frequency = row.strategy[index];
  if (frequency === undefined) {
    throw upstreamInconsistent("solver-query answered a hand row without a frequency for every action.");
  }
  return frequency;
}
