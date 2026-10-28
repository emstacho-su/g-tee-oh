/**
 * The range-paint prompt (R3.17, O-300, O-302, ADR 0004, ADR 0018, ADR 0020): which node a
 * range_paint session paints next, derived from the session state alone, so GET next writes
 * nothing and a repeat answers the same prompt.
 *
 * Mechanism: prompt n (the practice counter) takes the draws hand n of a drill session would take
 * (sessions/randomness.ts handDraws over the session seed, SplitMix64; no Math.random). The pick
 * draw chooses one of the hero spots POST /sessions stored for the drill (sessions/spot.ts
 * pickSpot, which also applies alternate_seats), and a deal at the spot's line with the draw's deal
 * seed names the solution and the spot's node (the start node of a deal does not depend on the
 * seed, O-152; the api composes no node key, O-245). The node is then read with every row. The
 * brushes are the node's tree actions (ADR 0020), the classes to paint are every row the node holds
 * (solver-query's grade-range requires each held class once, O-300), and the hero seat, history and
 * synthetic flag come from the spot and the node as the drill prompt shows them. Nothing here
 * computes a poker number (ADR 0004).
 */
import type { z } from "zod";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { rangePaintPromptSchema } from "../schemas/range-paint.js";
import type { SqNode } from "../solver-query/client.js";
import { dealFilterOf } from "../sessions/deal-hand.js";
import { upstreamInconsistent } from "../sessions/problems.js";
import { toButton } from "../sessions/prompt.js";
import { handDraws } from "../sessions/randomness.js";
import type { SolverPort } from "../sessions/solver-port.js";
import { pickSpot } from "../sessions/spot.js";
import type { PersistedState } from "../sessions/state.js";

export type RangePaintPrompt = z.infer<typeof rangePaintPromptSchema>;

/** grade-range grades the 169 preflop classes only in v1 (O-300). */
const PAINTABLE_HAND_SPACE = "preflop_169";

export interface PaintSession {
  id: string;
  stateVersion: number;
  state: PersistedState;
}

/** The counter of a practice session; a range_paint session always carries one (O-302). */
export function paintCounter(state: PersistedState): number {
  if (state.practice?.kind !== "range_paint") {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "This session holds no range-painting state." });
  }
  return state.practice.counter;
}

function requirePaintable(node: SqNode, heroSeat: string): string {
  if (node.to_act !== heroSeat || node.hand_space !== PAINTABLE_HAND_SPACE || node.hands.length === 0) {
    throw upstreamInconsistent("solver-query answered the spot's node without the hero to act over the preflop classes.");
  }
  if (node.spot_class_key === null || node.spot_class_key === undefined) {
    throw upstreamInconsistent("solver-query answered the spot's node without its spot class.");
  }
  return node.spot_class_key;
}

/** The prompt of the session's current counter, read from solver-query and never written. */
export async function derivePaintPrompt(session: PaintSession, port: SolverPort): Promise<RangePaintPrompt> {
  const { state } = session;
  const counter = paintCounter(state);
  const draws = handDraws(state.seed, counter);
  const spot = pickSpot(state.spots, state.spot, counter, draws.pick);
  const deal = await port.deal(dealFilterOf(spot), draws.dealSeed);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined || deal.hero_position !== spot.hero_seat) {
    throw upstreamInconsistent("solver-query dealt the spot without a solution or with another seat to act.");
  }
  const node = await port.node(solutionId, deal.start_node_key);
  const spotClassKey = requirePaintable(node, spot.hero_seat);
  return {
    session_id: session.id,
    state_version: session.stateVersion,
    prompt_no: counter,
    solution_id: solutionId,
    node_key: node.node_key,
    spot_class_key: spotClassKey,
    hero_position: spot.hero_seat,
    history: spot.history.map((entry) => ({ ...entry })),
    actions: node.actions.map(toButton),
    hands: node.hands.map((row) => row.hand),
    synthetic: node.synthetic,
  };
}
