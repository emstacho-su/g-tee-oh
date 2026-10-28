/**
 * The hero spots a drill trains, found once at POST /sessions (R3.6, 05 section 4, O-249, ADR 0004,
 * ADR 0018, PR #25 review HIGH 1, re-review BLOCKER 1 and 2, LOW 6). POST /sessions may write, so it
 * searches the trees once and stores what it found in the session state; every hand is then dealt
 * straight at one of the spots (deal-hand.ts), and a filter the library cannot satisfy is a 422 at
 * creation instead of a session that never reaches a decision.
 *
 * Mechanism, per covered (configuration, pair), at most MAX_CONCURRENT_SOLVER_CALLS pairs at a time:
 * the seats of the pair the drill names as hero positions are the wanted seats. A deal at the
 * drill's line (or the pair's root) with SPOT_SEARCH_SEED gives the solution and the start node
 * (the api composes no node key beyond the root, O-245). The pair's preflop tree is then searched
 * breadth first through next_node_key, each node read with all its rows. A node is a hero spot when
 * a wanted seat acts there, its action_family (gto-model's classify, never a TypeScript reading of
 * the line, action-family.ts) is in one of the drill's families, and at least one of its rows passes
 * the hands filter (spot.ts). The spot records the line to deal at (the drill's line, then the
 * tokens of the path, as the dotted DealFilter line) and the path's actions as history labels.
 * Each pair's search reads at most MAX_SPOT_SEARCH_NODES nodes and keeps at most
 * MAX_SPOTS_PER_PAIR spots; the session keeps at most MAX_HERO_SPOTS in all, in pair order.
 *
 * Every read here is of a spot solver-query just said it covers, so a 404 is solver-query
 * contradicting itself: a 502 upstream problem, never a 404 for the drill (re-review LOW 6).
 */
import { HTTP_STATUS, ProblemError } from "../http/problem.js";
import { positionSchema } from "../schemas/common.js";
import type { SqNode } from "../solver-query/client.js";
import { familyMatches } from "./action-family.js";
import type { PairCandidate } from "./candidates.js";
import { mapBounded, MAX_CONCURRENT_SOLVER_CALLS } from "./concurrency.js";
import { dealFilterOf } from "./deal-hand.js";
import { upstreamInconsistent } from "./problems.js";
import type { SolverPort } from "./solver-port.js";
import { anyRowPasses, type SessionSpot } from "./spot.js";
import { MAX_HERO_SPOTS, type HeroSpot, type HistoryEntry } from "./state.js";

/** Nodes one pair's search may read; a v1 preflop tree holds far fewer. */
export const MAX_SPOT_SEARCH_NODES = 256;
/** Hero spots kept per pair, so one wide tree cannot crowd the others out of MAX_HERO_SPOTS. */
export const MAX_SPOTS_PER_PAIR = 16;
/** The search's deal seed: the solution and start node of a deal do not depend on the seed (O-152). */
export const SPOT_SEARCH_SEED = "0000000000000000";
const PAIR_SEPARATOR = "-";
const LINE_SEPARATOR = ".";
const PREFLOP = "preflop";

export interface SpotSearch {
  heroPositions: readonly string[];
  spot: SessionSpot;
  /** The drill's line, or null for the pair's root. */
  line: string | null;
  /** S41 (O-411 amended): a hero node is kept only when this accepts it (a quiz that can ask its level there). */
  accept?: (node: SqNode) => boolean;
}

interface Pending {
  key: string;
  tokens: readonly string[];
  history: readonly HistoryEntry[];
}

/** A 404 from a spot solver-query said it covers is solver-query contradicting itself: 502. */
async function covered<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error: unknown) {
    if (error instanceof ProblemError && error.status === HTTP_STATUS.notFound) {
      throw Object.assign(upstreamInconsistent("solver-query no longer holds a spot it reported covered."), { cause: error });
    }
    throw error;
  }
}

function lineOf(tokens: readonly string[]): string | null {
  return tokens.length === 0 ? null : tokens.join(LINE_SEPARATOR);
}

function heroSpotAt(candidate: PairCandidate, node: SqNode, pending: Pending): HeroSpot {
  return {
    config_id: candidate.config_id,
    pair: candidate.pair,
    line: lineOf(pending.tokens),
    hero_seat: positionSchema.parse(node.to_act),
    history: [...pending.history],
  };
}

function children(node: SqNode, pending: Pending): Pending[] {
  const seat = positionSchema.parse(node.to_act);
  return node.actions.flatMap((action) => {
    const next = action.next_node_key ?? null;
    if (next === null) {
      return [];
    }
    const entry = { position: seat, token: action.token, label: action.label };
    return [{ key: next, tokens: [...pending.tokens, action.token], history: [...pending.history, entry] }];
  });
}

async function spotsIn(candidate: PairCandidate, search: SpotSearch, port: SolverPort): Promise<HeroSpot[]> {
  const wanted = candidate.pair.split(PAIR_SEPARATOR).filter((seat) => search.heroPositions.includes(seat));
  if (wanted.length === 0) {
    return [];
  }
  const deal = await covered(port.deal(dealFilterOf({ ...candidate, line: search.line }), SPOT_SEARCH_SEED));
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined) {
    throw upstreamInconsistent("solver-query dealt a spot with no solution.");
  }
  const found: HeroSpot[] = [];
  const seen = new Set<string>([deal.start_node_key]);
  const queue: Pending[] = [{ key: deal.start_node_key, tokens: search.line === null ? [] : search.line.split(LINE_SEPARATOR), history: [] }];
  for (let read = 0; read < MAX_SPOT_SEARCH_NODES && found.length < MAX_SPOTS_PER_PAIR; read += 1) {
    const pending = queue.shift();
    if (pending === undefined) {
      break;
    }
    const node = await covered(port.node(solutionId, pending.key));
    if (node.street !== PREFLOP) {
      continue;
    }
    const hero = wanted.includes(node.to_act) && familyMatches(search.spot.preflop_action, node.action_family);
    if (hero && anyRowPasses(search.spot.hands, node.hands) && (search.accept?.(node) ?? true)) {
      found.push(heroSpotAt(candidate, node, pending));
    }
    for (const child of children(node, pending)) {
      if (!seen.has(child.key)) {
        seen.add(child.key);
        queue.push(child);
      }
    }
  }
  return found;
}

/** The hero spots of the covered candidates, in candidate order; empty when the drill can deal none. */
export async function heroSpotsFor(candidates: readonly PairCandidate[], search: SpotSearch, port: SolverPort): Promise<HeroSpot[]> {
  const perPair = await mapBounded(candidates, MAX_CONCURRENT_SOLVER_CALLS, (candidate) => spotsIn(candidate, search, port));
  return perPair.flat().slice(0, MAX_HERO_SPOTS);
}
