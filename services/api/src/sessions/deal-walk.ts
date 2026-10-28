/**
 * Dealing a hand to the hero's decision (R3.6, 05 section 4, O-249, O-245, O-151, O-152, PR #25
 * review HIGH 1): the dealing phase of the derivation (derive.ts). Pure with respect to the
 * database, like the rest of the derivation: the same state always deals the same hand.
 *
 * Mechanism, for deal attempt k of hand n (randomness.ts dealAttempts: attempt 0 is the hand's own
 * draws, later attempts derive new ones from its deal seed):
 * 1. the pick draw chooses a candidate (configuration, pair); heroSeatsFor gives the seats that may
 *    be the hero in hand n (alternate_seats takes one per hand, in turn; spot.ts);
 * 2. POST /v1/deal at the drill's line, or the pair's root, with the attempt's deal seed; the deal's
 *    hero_position is the seat to act at the start node and the villain the other seat, so each
 *    seat's combo is known. A manual hands list that holds neither playable seat's class is dealt
 *    again at once;
 * 3. the walk: at each node, read with the acting seat's combo, the actor is the hero when it is a
 *    playable seat and the tokens so far (the line, then the walk's history) are in one of the
 *    drill's preflop action families (families.ts). Otherwise its action is drawn from
 *    /v1/sample-action with the attempt's opponent generator state (the returned state replaces
 *    it, O-151), recorded in the history, and the walk moves to the action's next_node_key (O-245);
 * 4. at the hero's node the hero's row must pass the hands filter (spot.ts).
 * A walk that ends first (a fold, a closed street, a hand without a row at a node, a later street)
 * or a hero hand that fails the filter deals again, up to MAX_DEAL_ATTEMPTS attempts; past that the
 * drill cannot be dealt and the answer is a 422 no-coverage problem naming the hands filter.
 * POST /sessions has already checked that some node satisfies the filter (spot-search.ts), so the
 * bound is only reached by a hands list too narrow for the dealt ranges.
 */
import { positionSchema } from "../schemas/common.js";
import { actionKindSchema } from "../schemas/study.js";
import type { SqNode } from "../solver-query/client.js";
import { matchesFamilies, lineTokens } from "./families.js";
import { actionAt } from "./hand-actions.js";
import { filterUnmetProblem, upstreamInconsistent } from "./problems.js";
import { dealAttempts, handDraws, pickIndex, type HandDraws } from "./randomness.js";
import type { DealFilter, SolverPort } from "./solver-port.js";
import { comboMayPass, heroSeatsFor, rowPasses } from "./spot.js";
import { handStateSchema, type Candidate, type HandState, type HistoryEntry, type PersistedState } from "./state.js";

/** Deals one hand may take before the drill's filter counts as unmet (a narrow hands list needs hundreds). */
export const MAX_DEAL_ATTEMPTS = 2048;
/** Preflop actions a walk may sample before the hero acts; a preflop line is far shorter. */
export const MAX_WALK_ACTIONS = 32;
const PREFLOP = "preflop";

type Position = HandState["hero_position"];

export interface DealtHand {
  hand: HandState;
  /** The hero's node, read with the hero's hand. */
  node: SqNode;
}

interface Walk {
  actor: Position;
  other: Position;
  nodeKey: string;
  history: HistoryEntry[];
  rngState: string;
  lastKind: HandState["last_action_kind"];
}

interface Dealt {
  state: PersistedState;
  seats: readonly Position[];
  solutionId: string;
  combos: Readonly<Partial<Record<Position, string>>>;
  base: Omit<HandState, "hero_position" | "villain_position" | "hero_hand" | "villain_hand" | "node_key" | "history" | "opponent_rng_state" | "last_action_kind">;
}

export function dealFilterOf(line: string | null, spot: Pick<Candidate, "config_id" | "pair">): DealFilter {
  return { config_id: spot.config_id, pair: spot.pair, ...(line === null ? {} : { line }) };
}

function comboOf(dealt: Dealt, seat: Position): string {
  const combo = dealt.combos[seat];
  if (combo === undefined) {
    throw upstreamInconsistent("solver-query dealt no cards to a seat of the pair.");
  }
  return combo;
}

function heroHand(dealt: Dealt, walk: Walk): HandState {
  return handStateSchema.parse({
    ...dealt.base,
    hero_position: walk.actor,
    villain_position: walk.other,
    hero_hand: comboOf(dealt, walk.actor),
    villain_hand: comboOf(dealt, walk.other),
    node_key: walk.nodeKey,
    history: walk.history,
    opponent_rng_state: walk.rngState,
    last_action_kind: walk.lastKind,
  });
}

/** One walk step: the hero's hand at its node, the walk moved on, or undefined when it ended. */
async function step(dealt: Dealt, walk: Walk, port: SolverPort): Promise<DealtHand | Walk | undefined> {
  const { state, solutionId } = dealt;
  const node = await port.nodeForHand(solutionId, walk.nodeKey, comboOf(dealt, walk.actor));
  if (node === undefined || node.street !== PREFLOP) {
    return undefined;
  }
  if (node.to_act !== walk.actor) {
    throw upstreamInconsistent("solver-query answered a preflop node where the other seat acts.");
  }
  const tokens = [...lineTokens(state.line), ...walk.history.map((entry) => entry.token)];
  if (dealt.seats.includes(walk.actor) && matchesFamilies(state.spot.preflop_action, tokens)) {
    const row = node.hands[0];
    if (row === undefined) {
      throw upstreamInconsistent("solver-query answered no row for the hand it was asked about.");
    }
    return rowPasses(state.spot.hands, row) ? { hand: heroHand(dealt, walk), node } : undefined;
  }
  const sample = await port.sample(solutionId, walk.nodeKey, comboOf(dealt, walk.actor), walk.rngState);
  const action = actionAt(node, sample.action_index);
  if (action === undefined) {
    throw upstreamInconsistent("solver-query sampled an action the node does not hold.");
  }
  const next = action.next_node_key ?? null;
  if (next === null) {
    return undefined;
  }
  return {
    actor: walk.other,
    other: walk.actor,
    nodeKey: next,
    history: [...walk.history, { position: walk.actor, token: action.token, label: action.label }],
    rngState: sample.rng_state,
    lastKind: actionKindSchema.parse(action.kind),
  };
}

async function walkToHero(dealt: Dealt, start: Walk, port: SolverPort): Promise<DealtHand | undefined> {
  let walk = start;
  for (let taken = 0; taken <= MAX_WALK_ACTIONS; taken += 1) {
    const result = await step(dealt, walk, port);
    if (result === undefined || "hand" in result) {
      return result;
    }
    walk = result;
  }
  return undefined;
}

async function tryDeal(state: PersistedState, draws: HandDraws, port: SolverPort): Promise<DealtHand | undefined> {
  const candidate = state.candidates[pickIndex(draws.pick, state.candidates.length)];
  if (candidate === undefined) {
    throw upstreamInconsistent("The session has no candidate spot.");
  }
  const deal = await port.deal(dealFilterOf(state.line, candidate), draws.dealSeed);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined) {
    throw upstreamInconsistent("solver-query dealt a spot with no solution.");
  }
  const first = positionSchema.parse(deal.hero_position);
  const second = positionSchema.parse(deal.villain_position);
  const seats = heroSeatsFor(candidate, state.spot, state.hand_no);
  const combos = { [first]: deal.hero_hand, [second]: deal.villain_hand };
  if (!seats.some((seat) => combos[seat] !== undefined && comboMayPass(state.spot.hands, combos[seat]))) {
    return undefined;
  }
  const base: Dealt["base"] = {
    config_id: candidate.config_id,
    pair: candidate.pair,
    deal_seed: draws.dealSeed,
    deal_id: deal.deal_id,
    solution_id: solutionId,
    street: PREFLOP,
    end: null,
    board: [],
    roll_rng_state: draws.rollRngState,
  };
  const dealt: Dealt = { state, seats, solutionId, combos, base };
  const start: Walk = { actor: first, other: second, nodeKey: deal.start_node_key, history: [], rngState: draws.opponentRngState, lastKind: null };
  return walkToHero(dealt, start, port);
}

/** Deals hand `state.hand_no` to the hero's decision for the drill's spot (see the module doc). */
export async function dealToHero(state: PersistedState, port: SolverPort): Promise<DealtHand> {
  let attempts = 0;
  for (const draws of dealAttempts(handDraws(state.seed, state.hand_no))) {
    if (attempts === MAX_DEAL_ATTEMPTS) {
      break;
    }
    attempts += 1;
    const dealt = await tryDeal(state, draws, port);
    if (dealt !== undefined) {
      return dealt;
    }
  }
  throw filterUnmetProblem("handsNotDealt", `(${MAX_DEAL_ATTEMPTS} deals were tried for hand ${state.hand_no}.)`);
}
