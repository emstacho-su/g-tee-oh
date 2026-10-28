/**
 * GET /progress/frequencies (R4.12, S41, O-353, O-417, O-418): your preflop action frequencies against
 * the solver's, per node and hand class.
 *
 * Mechanism: frequency-repository.ts reads the counted decisions of the user's most played spots (a
 * node of the solution the decisions were graded on, PR #39 review finding 6).
 * Each node's labels, seat, pair, configuration and family come from one solver-query node read for
 * its most played hand class (frequency-labels.ts, under one request deadline, a few at a time); a
 * node the library no longer holds is left out. Per node: your frequency of each action is the share
 * of your decisions that chose it, the solver's is the mean stored frequency over the same decisions;
 * the pooled row shows from MIN_SPOT_DECISIONS and a hand class row from MIN_HAND_DECISIONS, the
 * largest gap (total variation distance) first, ties by hand class. With no counted decision nothing
 * is read from solver-query.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import { requireDatabase } from "../http/database.js";
import { positionSchema } from "../schemas/common.js";
import {
  MIN_HAND_DECISIONS,
  MIN_SPOT_DECISIONS,
  type FrequencyComparison,
  type HandFrequency,
  type SpotFrequency,
} from "../schemas/frequencies.js";
import type { SqNode } from "../solver-query/client.js";
import { requireSolverQuery } from "../solver-query/client.js";
import { readSpotNodes } from "./frequency-labels.js";
import { frequencyRows, type FrequencyCellRow, type FrequencySpotRow } from "./frequency-repository.js";

export interface FrequencyCall {
  app: FastifyInstance;
  request: FastifyRequest;
  userId: string;
}

const HALF = 0.5;

interface Row {
  decisions: number;
  your_freq: number[];
  solver_freq: number[];
}

/** One (node, hand class or pooled) row from its per-action cells, in action order. */
function rowOf(cells: readonly FrequencyCellRow[], width: number): Row | undefined {
  const ordered = [...cells].sort((a, b) => a.position - b.position);
  const decisions = ordered[0]?.decisions ?? 0;
  if (ordered.length !== width || decisions === 0) {
    return undefined;
  }
  return {
    decisions,
    your_freq: ordered.map((cell) => cell.chosen / decisions),
    solver_freq: ordered.map((cell) => cell.solverFreq),
  };
}

/** Total variation distance between your frequencies and the solver's. */
function gapOf(row: Row): number {
  return HALF * row.your_freq.reduce((sum, yours, index) => sum + Math.abs(yours - (row.solver_freq[index] ?? 0)), 0);
}

function handRows(cells: readonly FrequencyCellRow[], width: number): HandFrequency[] {
  const byHand = new Map<string, FrequencyCellRow[]>();
  for (const cell of cells) {
    if (cell.handClass !== null) {
      byHand.set(cell.handClass, [...(byHand.get(cell.handClass) ?? []), cell]);
    }
  }
  const rows = [...byHand.entries()].flatMap(([handClass, handCells]) => {
    const row = rowOf(handCells, width);
    return row === undefined || row.decisions < MIN_HAND_DECISIONS ? [] : [{ hand_class: handClass, ...row }];
  });
  return rows.sort((a, b) => gapOf(b) - gapOf(a) || a.hand_class.localeCompare(b.hand_class));
}

function spotOf(spot: FrequencySpotRow, node: SqNode, cells: readonly FrequencyCellRow[]): SpotFrequency | undefined {
  const width = node.actions.length;
  const pooled = rowOf(
    cells.filter((cell) => cell.handClass === null),
    width,
  );
  if (pooled === undefined) {
    return undefined;
  }
  return {
    solution_id: spot.solutionId,
    node_key: spot.nodeKey,
    spot_class_key: spot.spotClassKey,
    config_id: node.config_id,
    pair: node.pair,
    hero_position: positionSchema.parse(node.to_act),
    action_family: node.action_family ?? null,
    decisions: pooled.decisions,
    actions: node.actions.map((action) => ({ index: action.index, label: action.label, kind: action.kind })),
    pooled: pooled.decisions < MIN_SPOT_DECISIONS ? null : { your_freq: pooled.your_freq, solver_freq: pooled.solver_freq },
    hands: handRows(cells, width),
  };
}

export async function frequencyProgress(call: FrequencyCall): Promise<FrequencyComparison> {
  const rows = await frequencyRows(requireDatabase(call.app), call.userId);
  const empty: FrequencyComparison = { min_spot_decisions: MIN_SPOT_DECISIONS, min_hand_decisions: MIN_HAND_DECISIONS, spots: [] };
  if (rows.spots.length === 0) {
    return empty;
  }
  const nodes = await readSpotNodes(requireSolverQuery(call.app), call.request, rows.spots);
  const spots = rows.spots.flatMap((spot, index) => {
    const node = nodes[index];
    if (node === undefined) {
      return [];
    }
    const built = spotOf(
      spot,
      node,
      rows.cells.filter((cell) => cell.solutionId === spot.solutionId && cell.nodeKey === spot.nodeKey),
    );
    return built === undefined ? [] : [built];
  });
  return { ...empty, spots };
}
