/**
 * Deriving the next prompt from the persisted state (R3.6, A6 section 2, the S23 "GET /next is
 * pure" rule, O-249, O-245). GET /sessions/{id}/next runs this and writes nothing; POST decisions
 * runs it again, gets the same result, and persists it with the decision.
 *
 * Mechanism: starting from the persisted phase (dealing after POST /sessions, feedback after a
 * decision), the machine (machine.ts) is driven through every phase that needs no hero input until
 * it reaches await_hero. Each step reads solver-query only through pure calls (solver-port.ts):
 * - dealing: hand n is dealt at one of the hero spots POST /sessions stored, so its start node is
 *   the hero's decision; a hand that finds no passing deal advances the hand number (deal-hand.ts);
 * - opponent_acts: /v1/sample-action draws the opponent's action from the opponent generator state
 *   in the hand, and the returned state replaces it (O-151); the action's next_node_key is the
 *   node the hand moves to (O-245); null ends the hand after a fold and closes the street after
 *   any other action, and a next node on a later street (postflop data, v1.5) closes the street
 *   too, so the reveal comes first and then whoever acts at that node;
 * - feedback, street_end: the facts of the last action decide the event; the machine applies the
 *   stop rule;
 * - reveal: the next street's cards from /v1/deal/{id}/reveal, after the deal is posted again so
 *   solver-query holds it even if its store dropped it (a pure function of seed and filter);
 * - hand_end: the next hand number, the revealed board kept as previous_board.
 * A hand whose solution holds no row for the acting hand at a node (a line the equilibrium never
 * plays it to) ends there ("off_range"). The loop is bounded by MAX_DERIVATION_STEPS; exceeding it
 * is a 500, since every real hand reaches the hero in a few steps.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { cardSchema } from "../schemas/common.js";
import type { SqAction, SqNode } from "../solver-query/client.js";
import { dealFilterOf, dealHand } from "./deal-hand.js";
import { actionAt, withAction } from "./hand-actions.js";
import { transition, type AfterFeedback, type MachineEvent, type MachineState, type Phase, type StopRule } from "./machine.js";
import { sessionEndedProblem, upstreamInconsistent as inconsistent } from "./problems.js";
import { drawRoll, type RollDraw } from "./randomness.js";
import type { SolverPort } from "./solver-port.js";
import type { HandState, PersistedState, PreviousHand } from "./state.js";

export { actionAt, sessionEndedProblem, withAction };

/** Machine steps one GET /next may take before it is a 500: a hand reaches the hero in under ten. */
export const MAX_DERIVATION_STEPS = 64;

const CARD_TEXT_LENGTH = 2;

type Street = HandState["street"];
const NEXT_STREET: Readonly<Partial<Record<Street, Street>>> = { preflop: "flop", flop: "turn", turn: "river" };

export interface DeriveSettings {
  stopRule: StopRule;
  rng: boolean;
}

export interface DerivedPrompt {
  /** The state at await_hero, as POST decisions would persist it with the decision. */
  state: PersistedState;
  hand: HandState;
  node: SqNode;
  roll: RollDraw | null;
}

interface Context {
  state: PersistedState;
  node: SqNode | undefined;
}

interface Step {
  event: MachineEvent;
  context: Context;
}

/** One phase step; the steps that read nothing from solver-query answer synchronously. */
type StepFn = (context: Context, port: SolverPort) => Promise<Step> | Step;

/** Board or hand text ("AhKd", "3cKh4c") as cards. */
export function cardsOf(text: string): string[] {
  const cards = text.match(/.{2}/g) ?? [];
  if (cards.length * CARD_TEXT_LENGTH !== text.length) {
    throw inconsistent("solver-query answered malformed cards.");
  }
  return cards.map((card) => cardSchema.parse(card));
}

function requireHand(state: PersistedState): HandState {
  if (state.hand === null) {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "The session has no hand in play." });
  }
  return state.hand;
}

function requireNodeKey(hand: HandState): string {
  if (hand.node_key === null) {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "The hand has no node to act at." });
  }
  return hand.node_key;
}

/** The hand dealt at one of the session's hero spots; a later hand number when earlier ones found no hand (deal-hand.ts). */
const dealing: StepFn = async ({ state }, port) => {
  const { hand, node, handNo } = await dealHand(state, port);
  return { event: { type: "dealt", heroToAct: true }, context: { state: { ...state, hand_no: handNo, hand }, node } };
};

function requireHeroActs(hand: HandState, node: SqNode): SqNode {
  if (node.to_act !== hand.hero_position) {
    throw inconsistent("solver-query answered a node where the hero does not act.");
  }
  return node;
}

/** True when the node is on a later street than the hand: the last action closed the street (v1.5 data). */
function opensStreet(hand: HandState, node: SqNode): boolean {
  return node.street !== hand.street;
}

const opponentActs: StepFn = async ({ state }, port) => {
  const hand = requireHand(state);
  const nodeKey = requireNodeKey(hand);
  const node = await port.nodeForHand(hand.solution_id, nodeKey, hand.villain_hand);
  const stopped = (stoppedHand: HandState): Step => ({
    event: { type: "opponent_acted", heroToAct: false },
    context: { state: { ...state, hand: stoppedHand }, node: undefined },
  });
  if (node === undefined) {
    return stopped({ ...hand, end: "off_range" });
  }
  if (opensStreet(hand, node)) {
    return stopped({ ...hand, end: "street_closed" });
  }
  const sample = await port.sample(hand.solution_id, nodeKey, hand.villain_hand, hand.opponent_rng_state);
  const action = actionAt(node, sample.action_index);
  if (action === undefined) {
    throw inconsistent("solver-query sampled an action the node does not hold.");
  }
  const acted = { ...withAction(hand, hand.villain_position, action), opponent_rng_state: sample.rng_state };
  if (acted.end !== null) {
    return stopped(acted);
  }
  const heroNode = await port.nodeForHand(acted.solution_id, requireNodeKey(acted), acted.hero_hand);
  if (heroNode === undefined) {
    return stopped({ ...acted, end: "off_range" });
  }
  if (opensStreet(acted, heroNode)) {
    return stopped({ ...acted, end: "street_closed" });
  }
  return {
    event: { type: "opponent_acted", heroToAct: true },
    context: { state: { ...state, hand: acted }, node: requireHeroActs(acted, heroNode) },
  };
};

const feedback: StepFn = ({ state }) => {
  const hand = requireHand(state);
  const next: AfterFeedback = hand.end === null ? "opponent" : hand.end === "street_closed" ? "street_end" : "hand_end";
  return { event: { type: "feedback_closed", next }, context: { state, node: undefined } };
};

const streetEnd: StepFn = ({ state }) => {
  const hand = requireHand(state);
  const handOver = hand.end === "fold" || hand.end === "off_range";
  const nextStreet = NEXT_STREET[hand.street] !== undefined;
  return { event: { type: "street_closed", handOver, nextStreet }, context: { state, node: undefined } };
};

const reveal: StepFn = async ({ state }, port) => {
  const hand = requireHand(state);
  const street = NEXT_STREET[hand.street];
  if (street === undefined) {
    throw inconsistent("There is no street after the river to reveal.");
  }
  await port.deal(dealFilterOf(hand), hand.deal_seed);
  const revealed = await port.reveal(hand.deal_id, street);
  const handOver = hand.end === "fold" || hand.end === "off_range";
  const shown: HandState = { ...hand, street, board: cardsOf(revealed.board), end: handOver ? hand.end : null };
  const next = { ...state, hand: shown };
  if (shown.node_key === null || handOver) {
    // v1: the library ends at the flop, so the hand ends once it is shown (05 section 2).
    return { event: { type: "revealed", next: "none" }, context: { state: next, node: undefined } };
  }
  const heroNode = await port.nodeForHand(shown.solution_id, shown.node_key, shown.hero_hand);
  const heroActs = heroNode !== undefined && heroNode.to_act === shown.hero_position;
  return {
    event: { type: "revealed", next: heroActs ? "hero" : "opponent" },
    context: { state: next, node: heroActs ? heroNode : undefined },
  };
};

/**
 * How a hand closed, for the next prompt's previous_hand (O-313). A reveal clears hand.end when
 * the hand goes on (v1: the flop is shown and the hand ends), so a cleared end with a board is
 * the street closing; a cleared end with no board is the stop rule ending the hand (spot mode).
 */
function previousHandOf(handNo: number, hand: HandState): PreviousHand {
  const end = hand.end ?? (hand.board.length > 0 ? "street_closed" : "stop_rule");
  return { hand_no: handNo, history: hand.history.map((entry) => ({ ...entry })), board: [...hand.board], end };
}

const handEnd: StepFn = ({ state }) => {
  const hand = requireHand(state);
  const next: PersistedState = {
    ...state,
    hand_no: state.hand_no + 1,
    hand: null,
    previous_board: hand.board.length > 0 ? hand.board : null,
    previous_hand: previousHandOf(state.hand_no, hand),
  };
  return { event: { type: "next_hand" }, context: { state: next, node: undefined } };
};

const STEPS: Readonly<Record<Exclude<Phase, "await_hero" | "ended">, StepFn>> = {
  dealing,
  opponent_acts: opponentActs,
  feedback,
  street_end: streetEnd,
  reveal,
  hand_end: handEnd,
};

async function finish(context: Context, rng: boolean, port: SolverPort): Promise<DerivedPrompt> {
  const hand = requireHand(context.state);
  const node = context.node ?? (await port.nodeForHand(hand.solution_id, requireNodeKey(hand), hand.hero_hand));
  if (node === undefined) {
    throw inconsistent("solver-query holds no row for the hero's hand at this node.");
  }
  requireHeroActs(hand, node);
  const roll = rng ? drawRoll(hand.roll_rng_state) : null;
  return { state: context.state, hand, node, roll };
}

/**
 * Runs the machine from the persisted state to the hero's next decision. Pure with respect to the
 * database: it reads solver-query only, and the same state always yields the same result.
 */
export async function deriveAwaitHero(state: PersistedState, settings: DeriveSettings, port: SolverPort): Promise<DerivedPrompt> {
  let machine: MachineState = { phase: state.phase, stopRule: settings.stopRule };
  let context: Context = { state, node: undefined };
  for (let step = 0; step <= MAX_DERIVATION_STEPS; step += 1) {
    if (machine.phase === "await_hero") {
      return finish(context, settings.rng, port);
    }
    if (machine.phase === "ended") {
      throw sessionEndedProblem();
    }
    const result = await STEPS[machine.phase](context, port);
    machine = transition(machine, result.event);
    context = { node: result.context.node, state: { ...result.context.state, phase: machine.phase } };
  }
  throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, {
    detail: `The session did not reach a decision within ${MAX_DERIVATION_STEPS} steps.`,
  });
}

/**
 * The state POST decisions persists: the hero's action applied to the derived hand, the roll state
 * advanced when a roll was drawn, and the phase moved to feedback.
 */
export function afterHeroDecision(derived: DerivedPrompt, action: SqAction, attemptId: string, stopRule: StopRule): PersistedState {
  const phase = transition({ phase: derived.state.phase, stopRule }, { type: "hero_decided" }).phase;
  const acted = withAction(derived.hand, derived.hand.hero_position, action);
  const hand = derived.roll === null ? acted : { ...acted, roll_rng_state: derived.roll.state };
  return { ...derived.state, phase, hand, last_attempt_id: attemptId };
}
