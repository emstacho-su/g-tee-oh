/**
 * solver-query bodies to the api's study shapes (R3.3, ADR 0004, O-229). Every number is copied
 * as solver-query answered it; the only changes are names the api contract already fixed and
 * optional upstream fields made explicit nulls, so the web reads one shape.
 */
import type { z } from "zod";

import type { SqInsights, SqNode } from "../solver-query/client.js";
import type { studyInsightsSchema, studyNodeSchema } from "../schemas/study.js";

export type StudyNode = z.infer<typeof studyNodeSchema>;
export type StudyInsights = z.infer<typeof studyInsightsSchema>;
type StudyPosition = StudyNode["to_act"];
type StudyStreet = StudyNode["street"];

/** Where the next likely action leads, as the response names it. */
export interface NextLikely {
  line: string | null;
  nodeKey: string | null;
}

/**
 * The StudyNode body. to_act and street are typed as plain strings in solver-query's contract;
 * the response serializer validates them against the api's enums, so a value outside them is a
 * 500 that names the mismatch in the log, never a silently wrong body.
 */
export function toStudyNode(node: Readonly<SqNode>, next: NextLikely): StudyNode {
  return {
    solution_id: node.solution_id,
    node_key: node.node_key,
    config_id: node.config_id,
    pair: node.pair,
    street: node.street as StudyStreet,
    to_act: node.to_act as StudyPosition,
    pot_cbb: node.pot_cbb,
    stacks_cbb: [...node.stacks_cbb],
    floor_pct_pot: node.floor_pct_pot,
    spot_class_key: node.spot_class_key ?? null,
    actions: node.actions.map((action) => ({
      index: action.index,
      token: action.token,
      kind: action.kind,
      size_cbb: action.size_cbb,
      bucket: action.bucket ?? null,
      label: action.label,
      next_node_key: action.next_node_key ?? null,
    })),
    hands: node.hands.map((row) => ({
      hand: row.hand,
      strategy: [...row.strategy],
      ev_bb: [...row.ev_bb],
      ev_best_bb: row.ev_best_bb,
      loss_pct_pot: [...row.loss_pct_pot],
      reach: row.reach === undefined || row.reach === null ? null : [...row.reach],
      mixed: row.mixed,
    })),
    noise_flags: [...node.noise_flags],
    next_likely_line: next.line,
    next_likely_node_key: next.nodeKey,
    synthetic: node.synthetic,
    // O-281, O-469: copied from solver-query's range summary, never summed here (ADR 0004).
    range_by_action: node.range_summary.by_action.map((entry) => ({
      index: entry.index,
      share: entry.share,
      ...(typeof entry.combos === "number" ? { combos: entry.combos } : {}),
    })),
    range_combos: actingSeatRange(node),
  };
}

/**
 * The acting seat's range (O-469): the pair names the out-of-position seat first, so the seat to
 * act is `oop` when it is the pair's first position and `ip` otherwise. A name comparison only; the
 * numbers are solver-query's.
 */
function actingSeatRange(node: Readonly<SqNode>): StudyNode["range_combos"] {
  const [outOfPosition] = node.pair.split("-");
  const seat = node.to_act === outOfPosition ? node.range_summary.oop : node.range_summary.ip;
  return { combos: seat.combos, reach_weighted_combos: seat.reach_weighted_combos };
}

export function toStudyInsights(insights: SqInsights): StudyInsights {
  const card = insights.threshold_card ?? null;
  return {
    threshold_card:
      card === null
        ? null
        : {
            actions: card.actions.map((action) => ({
              index: action.index,
              token: action.token,
              share_taking: action.share_taking,
              weakest_hand_taking_half: action.weakest_hand_taking_half ?? null,
            })),
            strongest_folding_hand: card.strongest_folding_hand ?? null,
            hand_position: card.hand_position,
          },
    equity_distribution: insights.equity_distribution ?? null,
    range_advantage: insights.range_advantage ?? null,
    nut_advantage: insights.nut_advantage ?? null,
    blockers: insights.blockers,
    hand_role: insights.hand_role ?? null,
    noise_flags: [...insights.noise_flags],
  };
}
