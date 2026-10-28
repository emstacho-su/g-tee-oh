/**
 * Dealing a hand at one of the session's hero spots (R3.6, 05 section 4, O-249, O-152, PR #25
 * re-review BLOCKER 2): the dealing phase of the derivation (derive.ts). Pure with respect to the
 * database, like the rest of the derivation: the same state always deals the same hand.
 *
 * POST /sessions stored the hero spots (spot-search.ts): each a line at which a seat the drill
 * names acts in one of its families. So a hand needs no walk: for deal attempt k of hand n
 * (randomness.ts dealAttempts: attempt 0 is the hand's own draws, later attempts derive new ones
 * from its deal seed),
 * 1. the pick draw chooses a hero spot (spot.ts pickSpot, which applies alternate_seats);
 * 2. POST /v1/deal at the spot's line with the attempt's deal seed: the start node is the hero's
 *    decision, and the deal's hero_position (the seat to act there) must be the spot's hero seat;
 * 3. a manual hands list that lacks the hero's class deals again at once, with no node read;
 * 4. the hero's node is read with the hero's hand; a hand outside the hero's range there, or a
 *    row the hands filter refuses (close decisions), deals again;
 * 5. a hand the holdout guard holds back (S31, O-276: the hero's row at that node is a holdout item)
 *    deals again, so drills and automated sessions never serve a holdout item (holdout-guard.ts).
 * A spot pinned to a stored deal (S31, O-276: a holdout session's item, HeroSpot.deal_seed) is dealt
 * with that seed instead of the attempt's, and takes a single attempt when every spot is pinned.
 * The history before the hero is the spot's line, as the spot recorded it; nothing is sampled.
 *
 * Bounds: a hand takes at most MAX_DEAL_ATTEMPTS attempts, one deal call each when a manual list
 * refuses the class and two otherwise. The narrowest manual list, a single pair (6 of 1,326
 * combos, about 0.45 percent), passes within 256 attempts about 69 percent of the time per hand.
 * A hand that exhausts its attempts advances to the next hand number (the derived state carries
 * the hand actually dealt, which POST decisions persists), up to MAX_HANDS_PER_DEAL hands; the last
 * of them relaxes the hands filter to all, so a session is never stuck on its filter: a narrow
 * list fails its first three hands about 3 percent of the time, and then one hand ignores it. The
 * worst case is 1,024 attempts: about 1,000 deal calls for a manual list (it refuses before any
 * node read), which fits the request deadline (solver-port.ts SESSION_DEADLINE_MS) at local call
 * times; past the deadline the answer is a transient 503. Past the last hand, which needs only a
 * hand in the hero's range, the answer is a 422 naming that.
 */
import type { SqNode } from "../solver-query/client.js";
import { filterUnmetProblem, upstreamInconsistent } from "./problems.js";
import { dealAttempts, handDraws, type HandDraws } from "./randomness.js";
import { EMPTY_HOLDOUT_GUARD, type HoldoutGuard } from "./holdout-guard.js";
import type { DealFilter, SolverPort } from "./solver-port.js";
import { comboMayPass, pickSpot, rowPasses, type HandsFilter } from "./spot.js";
import { handStateSchema, type HandState, type HeroSpot, type PersistedState } from "./state.js";

/** Deal attempts one hand may take (see the module doc for the arithmetic). */
export const MAX_DEAL_ATTEMPTS = 256;
/** Hands one derivation may advance through; the last relaxes the hands filter to all. */
export const MAX_HANDS_PER_DEAL = 4;
const ALL_HANDS: HandsFilter = { mode: "all" };
const PREFLOP = "preflop";

export interface DealtHand {
  hand: HandState;
  /** The hero's node, read with the hero's hand. */
  node: SqNode;
  /** The hand number actually dealt: the state's, or a later one when earlier hands exhausted their attempts. */
  handNo: number;
}

export function dealFilterOf(spot: Pick<HeroSpot, "config_id" | "pair" | "line">): DealFilter {
  return { config_id: spot.config_id, pair: spot.pair, ...(spot.line === null ? {} : { line: spot.line }) };
}

interface DealContext {
  port: SolverPort;
  guard: HoldoutGuard;
}

async function tryDeal(state: PersistedState, handNo: number, hands: HandsFilter, draws: HandDraws, context: DealContext): Promise<DealtHand | undefined> {
  const { port, guard } = context;
  const spot = pickSpot(state.spots, state.spot, handNo, draws.pick);
  const dealSeed = spot.deal_seed ?? draws.dealSeed;
  const deal = await port.deal(dealFilterOf(spot), dealSeed);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined) {
    throw upstreamInconsistent("solver-query dealt a spot with no solution.");
  }
  if (deal.hero_position !== spot.hero_seat) {
    throw upstreamInconsistent("solver-query dealt the spot's line with another seat to act.");
  }
  if (!comboMayPass(hands, deal.hero_hand)) {
    return undefined;
  }
  const node = await port.nodeForHand(solutionId, deal.start_node_key, deal.hero_hand);
  if (node === undefined) {
    return undefined;
  }
  const row = node.hands[0];
  if (node.to_act !== spot.hero_seat || row === undefined) {
    throw upstreamInconsistent("solver-query answered the hero's node without the hero to act or the hero's row.");
  }
  if (guard.isHeldOut(solutionId, deal.start_node_key, row.hand)) {
    return undefined;
  }
  if (!rowPasses(hands, row)) {
    return undefined;
  }
  const hand = handStateSchema.parse({
    config_id: spot.config_id,
    pair: spot.pair,
    line: spot.line,
    deal_seed: dealSeed,
    deal_id: deal.deal_id,
    solution_id: solutionId,
    hero_position: deal.hero_position,
    villain_position: deal.villain_position,
    hero_hand: deal.hero_hand,
    villain_hand: deal.villain_hand,
    street: PREFLOP,
    node_key: deal.start_node_key,
    end: null,
    last_action_kind: null,
    history: spot.history,
    dealt_history_length: spot.history.length,
    board: [],
    opponent_rng_state: draws.opponentRngState,
    roll_rng_state: draws.rollRngState,
  });
  return { hand, node, handNo };
}

/** A pinned spot deals one stored deal, so a second attempt would only repeat it (S31, O-276). */
const PINNED_DEAL_ATTEMPTS = 1;

function attemptLimit(state: PersistedState): number {
  return state.spots.every((spot) => spot.deal_seed !== undefined) ? PINNED_DEAL_ATTEMPTS : MAX_DEAL_ATTEMPTS;
}

async function dealOneHand(state: PersistedState, handNo: number, hands: HandsFilter, context: DealContext): Promise<DealtHand | undefined> {
  let attempts = 0;
  const limit = attemptLimit(state);
  for (const draws of dealAttempts(handDraws(state.seed, handNo))) {
    if (attempts === limit) {
      return undefined;
    }
    attempts += 1;
    const dealt = await tryDeal(state, handNo, hands, draws, context);
    if (dealt !== undefined) {
      return dealt;
    }
  }
  return undefined;
}

/** Deals the state's hand, or a later one, at a hero spot (see the module doc). */
export async function dealHand(state: PersistedState, port: SolverPort, guard: HoldoutGuard = EMPTY_HOLDOUT_GUARD): Promise<DealtHand> {
  const context: DealContext = { port, guard };
  for (let offset = 0; offset < MAX_HANDS_PER_DEAL; offset += 1) {
    const relaxed = offset === MAX_HANDS_PER_DEAL - 1;
    const dealt = await dealOneHand(state, state.hand_no + offset, relaxed ? ALL_HANDS : state.spot.hands, context);
    if (dealt !== undefined) {
      return dealt;
    }
  }
  throw filterUnmetProblem("noHandInRange", `(${MAX_HANDS_PER_DEAL} hands of ${MAX_DEAL_ATTEMPTS} deals each were tried.)`);
}
