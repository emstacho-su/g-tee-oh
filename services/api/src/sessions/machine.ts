/**
 * The training session state machine (R3.6, A6 section 2, 05 sections 2 and 4). Pure: transition
 * takes a state and an event and returns a new state, with no input/output, no clock and no
 * randomness, so the transition table is tested exhaustively and every caller (GET /next's
 * derivation, POST decisions, POST end) moves through the same rules.
 *
 * Mechanism: each phase accepts the events listed in its handler; any other event throws
 * InvalidTransitionError naming the phase and the event, which the routes report as a 500 because
 * the derivation only ever sends events its facts produce. Events carry facts (who acts next,
 * whether the hand is over, whether another street exists), and the machine applies the stop rule
 * of the drill's trainer settings (trainer.stop_rule, 05 section 4) to them:
 * - after_action (spot mode): feedback always goes to hand_end;
 * - end_of_street (street mode): street_end goes to hand_end, never to reveal;
 * - end_of_hand (full-hand mode): street_end goes to reveal while another street exists.
 * In v1 the library holds preflop only, so a full hand reveals the flop and then ends (05 section
 * 2): reveal goes to hand_end when no postflop node follows, the one edge added to A6's diagram.
 * Reveal to await_hero and to opponent_acts are the v1.5 edges; the machine supports them now.
 * The player may end a session from any phase but ended (POST /sessions/{id}/end); A6's
 * hand_end to the end is the same event.
 */
import { sessionStateSchema } from "../schemas/training.js";
import { trainerSettingsSchema } from "../schemas/drills.js";

export const PHASES = sessionStateSchema.options;
export type Phase = (typeof PHASES)[number];

export const STOP_RULES = trainerSettingsSchema.shape.stop_rule.options;
export type StopRule = (typeof STOP_RULES)[number];

export interface MachineState {
  readonly phase: Phase;
  readonly stopRule: StopRule;
}

/** What follows a graded decision, before the stop rule applies. */
export type AfterFeedback = "opponent" | "street_end" | "hand_end";
/** Who acts after a street is revealed; none when the library holds no node there (v1). */
export type AfterReveal = "hero" | "opponent" | "none";

export type MachineEvent =
  | { readonly type: "dealt"; readonly heroToAct: boolean }
  | { readonly type: "opponent_acted"; readonly heroToAct: boolean }
  | { readonly type: "hero_decided" }
  | { readonly type: "feedback_closed"; readonly next: AfterFeedback }
  | { readonly type: "street_closed"; readonly handOver: boolean; readonly nextStreet: boolean }
  | { readonly type: "revealed"; readonly next: AfterReveal }
  | { readonly type: "next_hand" }
  | { readonly type: "session_ended" };

export type EventType = MachineEvent["type"];

export const EVENT_TYPES: readonly EventType[] = [
  "dealt",
  "opponent_acted",
  "hero_decided",
  "feedback_closed",
  "street_closed",
  "revealed",
  "next_hand",
  "session_ended",
];

/** An event the phase does not accept. */
export class InvalidTransitionError extends Error {
  readonly phase: Phase;
  readonly eventType: EventType;

  constructor(phase: Phase, eventType: EventType) {
    super(`the session cannot take ${eventType} in phase ${phase}`);
    this.name = "InvalidTransitionError";
    this.phase = phase;
    this.eventType = eventType;
  }
}

type Handler = (event: MachineEvent, stopRule: StopRule) => Phase | undefined;

const AFTER_REVEAL: Readonly<Record<AfterReveal, Phase>> = {
  hero: "await_hero",
  opponent: "opponent_acts",
  none: "hand_end",
};

const AFTER_FEEDBACK: Readonly<Record<AfterFeedback, Phase>> = {
  opponent: "opponent_acts",
  street_end: "street_end",
  hand_end: "hand_end",
};

const HANDLERS: Readonly<Record<Phase, Handler>> = {
  dealing: (event) => (event.type === "dealt" ? (event.heroToAct ? "await_hero" : "opponent_acts") : undefined),
  opponent_acts: (event) =>
    event.type === "opponent_acted" ? (event.heroToAct ? "await_hero" : "street_end") : undefined,
  await_hero: (event) => (event.type === "hero_decided" ? "feedback" : undefined),
  feedback: (event, stopRule) => {
    if (event.type !== "feedback_closed") {
      return undefined;
    }
    return stopRule === "after_action" ? "hand_end" : AFTER_FEEDBACK[event.next];
  },
  street_end: (event, stopRule) => {
    if (event.type !== "street_closed") {
      return undefined;
    }
    const reveal = !event.handOver && event.nextStreet && stopRule === "end_of_hand";
    return reveal ? "reveal" : "hand_end";
  },
  reveal: (event) => (event.type === "revealed" ? AFTER_REVEAL[event.next] : undefined),
  hand_end: (event) => (event.type === "next_hand" ? "dealing" : undefined),
  ended: () => undefined,
};

/** The state after `event`; throws InvalidTransitionError when the phase does not accept it. */
export function transition(state: MachineState, event: MachineEvent): MachineState {
  if (event.type === "session_ended" && state.phase !== "ended") {
    return { ...state, phase: "ended" };
  }
  const next = HANDLERS[state.phase](event, state.stopRule);
  if (next === undefined) {
    throw new InvalidTransitionError(state.phase, event.type);
  }
  return { ...state, phase: next };
}
