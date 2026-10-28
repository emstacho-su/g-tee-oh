/**
 * Which covered spots a drill can actually deal, and at which seats (R3.6, 05 section 4, O-249,
 * ADR 0018, PR #25 review HIGH 1): POST /sessions runs this once, so a filter the library cannot
 * satisfy is a 422 at creation instead of a session that never reaches a decision.
 *
 * Mechanism, per covered (configuration, pair), at most MAX_CONCURRENT_SOLVER_CALLS pairs at a
 * time: the seats of the pair the drill names as hero positions are the wanted seats. A deal at
 * the drill's line (or the pair's root) with SPOT_SEARCH_SEED gives the solution and the start node
 * (the api composes no key beyond the root, O-245). The pair's preflop tree is then searched
 * breadth first through next_node_key, each node read with all its rows: a wanted seat to act at a
 * node whose tokens so far are in one of the drill's preflop action families (families.ts), with
 * at least one row passing the hands filter (spot.ts), is a playable hero seat. The search stops
 * when every wanted seat is found or after MAX_SPOT_SEARCH_NODES nodes. A pair with no playable
 * seat is dropped; the rest become the session's candidates with their seats in pair order.
 */
import { positionSchema } from "../schemas/common.js";
import type { PairCandidate } from "./candidates.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "./concurrency.js";
import { dealFilterOf } from "./deal-walk.js";
import { lineTokens, matchesFamilies } from "./families.js";
import { upstreamInconsistent } from "./problems.js";
import type { SolverPort } from "./solver-port.js";
import { anyRowPasses, type SessionSpot } from "./spot.js";
import type { Candidate } from "./state.js";

/** Nodes one pair's search may read; a v1 preflop tree holds far fewer. */
export const MAX_SPOT_SEARCH_NODES = 256;
/** The search's deal seed: the solution and start node of a deal do not depend on the seed (O-152). */
export const SPOT_SEARCH_SEED = "0000000000000000";
const PAIR_SEPARATOR = "-";
const PREFLOP = "preflop";

type Position = Candidate["hero_seats"][number];

export interface SpotSearch {
  heroPositions: readonly string[];
  spot: SessionSpot;
  line: string | null;
}

interface Pending {
  key: string;
  tokens: readonly string[];
}

async function heroSeatsIn(candidate: PairCandidate, search: SpotSearch, port: SolverPort): Promise<Position[]> {
  const wanted = candidate.pair.split(PAIR_SEPARATOR).filter((seat) => search.heroPositions.includes(seat));
  if (wanted.length === 0) {
    return [];
  }
  const deal = await port.deal(dealFilterOf(search.line, candidate), SPOT_SEARCH_SEED);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined) {
    throw upstreamInconsistent("solver-query dealt a spot with no solution.");
  }
  const found = new Set<string>();
  const seen = new Set<string>([deal.start_node_key]);
  const queue: Pending[] = [{ key: deal.start_node_key, tokens: lineTokens(search.line) }];
  for (let read = 0; read < MAX_SPOT_SEARCH_NODES && found.size < wanted.length; read += 1) {
    const pending = queue.shift();
    if (pending === undefined) {
      break;
    }
    const node = await port.node(solutionId, pending.key);
    if (node.street !== PREFLOP) {
      continue;
    }
    const playable = wanted.includes(node.to_act) && matchesFamilies(search.spot.preflop_action, pending.tokens);
    if (playable && anyRowPasses(search.spot.hands, node.hands)) {
      found.add(node.to_act);
    }
    for (const action of node.actions) {
      const next = action.next_node_key ?? null;
      if (next !== null && !seen.has(next)) {
        seen.add(next);
        queue.push({ key: next, tokens: [...pending.tokens, action.token] });
      }
    }
  }
  return wanted.filter((seat) => found.has(seat)).map((seat) => positionSchema.parse(seat));
}

/** The covered candidates with the seats the drill can put the hero in; pairs with none are dropped. */
export async function playableCandidates(candidates: readonly PairCandidate[], search: SpotSearch, port: SolverPort): Promise<Candidate[]> {
  const seats = await mapBounded(candidates, MAX_CONCURRENT_SOLVER_CALLS, (candidate) => heroSeatsIn(candidate, search, port));
  return candidates.flatMap((candidate, index) => {
    const heroSeats = seats[index] ?? [];
    return heroSeats.length === 0 ? [] : [{ ...candidate, hero_seats: heroSeats }];
  });
}
