/**
 * The node a practice prompt asks about (PR #29 review L11, R3.16, R3.17, O-152, O-245, ADR 0018):
 * the one place prediction/ and range-paint/ resolve a stored hero spot to {solutionId, node}.
 *
 * Mechanism: POST /v1/deal at the spot's line with the caller's seed (the deal's solution and start
 * node do not depend on the seed, O-152; the api composes no node key, O-245), then the start node
 * of the first solution read with every row. One seat check covers both answers: the deal's hero
 * position and the node's seat to act must both be the spot's hero seat, so a prompt is never
 * served for a seat the spot does not train. A deal with no solution, or another seat to act, is a
 * 502 upstream problem. Nothing is written and nothing is solved: both calls read the library.
 */
import type { SqDeal, SqNode } from "../solver-query/client.js";
import { dealFilterOf } from "./deal-hand.js";
import { upstreamInconsistent } from "./problems.js";
import type { SolverPort } from "./solver-port.js";
import type { HeroSpot } from "./state.js";

export interface PracticeNode {
  solutionId: string;
  node: SqNode;
}

function heroActs(spot: HeroSpot, deal: SqDeal, node: SqNode): boolean {
  return deal.hero_position === spot.hero_seat && node.to_act === spot.hero_seat;
}

/** The spot's solution and its hero node with every row; a 502 when solver-query answers otherwise. */
export async function resolvePracticeNode(spot: HeroSpot, dealSeed: string, port: SolverPort): Promise<PracticeNode> {
  const deal = await port.deal(dealFilterOf(spot), dealSeed);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined) {
    throw upstreamInconsistent("solver-query dealt a spot with no solution.");
  }
  const node = await port.node(solutionId, deal.start_node_key);
  if (!heroActs(spot, deal, node)) {
    throw upstreamInconsistent("solver-query answered the spot's node with another seat to act.");
  }
  return { solutionId, node };
}
