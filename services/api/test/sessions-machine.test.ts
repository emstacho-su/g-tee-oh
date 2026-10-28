/**
 * The session state machine's transition table (R3.6, A6 section 2, 05 sections 2 and 4): every
 * edge A6 section 2 draws, each stop rule's path through it, and every invalid phase and event pair
 * throwing a typed error. The machine is pure, so these run without a database or solver-query.
 */
import { describe, expect, it } from "vitest";

import {
  EVENT_TYPES,
  InvalidTransitionError,
  PHASES,
  STOP_RULES,
  transition,
  type MachineEvent,
  type MachineState,
  type Phase,
  type StopRule,
} from "../src/sessions/machine.js";

const FULL_HAND: StopRule = "end_of_hand";

function at(phase: Phase, stopRule: StopRule = FULL_HAND): MachineState {
  return { phase, stopRule };
}

interface Edge {
  from: Phase;
  event: MachineEvent;
  to: Phase;
  stopRule?: StopRule;
}

/** Every edge of A6 section 2, plus reveal to hand_end (v1 ends at the flop, 05 section 2). */
const EDGES: readonly Edge[] = [
  { from: "dealing", event: { type: "dealt", heroToAct: true }, to: "await_hero" },
  { from: "dealing", event: { type: "dealt", heroToAct: false }, to: "opponent_acts" },
  { from: "opponent_acts", event: { type: "opponent_acted", heroToAct: true }, to: "await_hero" },
  { from: "opponent_acts", event: { type: "opponent_acted", heroToAct: false }, to: "street_end" },
  { from: "await_hero", event: { type: "hero_decided" }, to: "feedback" },
  { from: "feedback", event: { type: "feedback_closed", next: "opponent" }, to: "opponent_acts" },
  { from: "feedback", event: { type: "feedback_closed", next: "street_end" }, to: "street_end" },
  { from: "feedback", event: { type: "feedback_closed", next: "hand_end" }, to: "hand_end" },
  { from: "street_end", event: { type: "street_closed", handOver: false, nextStreet: true }, to: "reveal" },
  { from: "street_end", event: { type: "street_closed", handOver: true, nextStreet: true }, to: "hand_end" },
  { from: "street_end", event: { type: "street_closed", handOver: false, nextStreet: false }, to: "hand_end" },
  { from: "reveal", event: { type: "revealed", next: "hero" }, to: "await_hero" },
  { from: "reveal", event: { type: "revealed", next: "opponent" }, to: "opponent_acts" },
  { from: "reveal", event: { type: "revealed", next: "none" }, to: "hand_end" },
  { from: "hand_end", event: { type: "next_hand" }, to: "dealing" },
  { from: "hand_end", event: { type: "session_ended" }, to: "ended" },
];

/** One event of each type, for the invalid-pair sweep. */
const SAMPLE_EVENTS: Readonly<Record<MachineEvent["type"], MachineEvent>> = {
  dealt: { type: "dealt", heroToAct: true },
  opponent_acted: { type: "opponent_acted", heroToAct: true },
  hero_decided: { type: "hero_decided" },
  feedback_closed: { type: "feedback_closed", next: "opponent" },
  street_closed: { type: "street_closed", handOver: false, nextStreet: true },
  revealed: { type: "revealed", next: "hero" },
  next_hand: { type: "next_hand" },
  session_ended: { type: "session_ended" },
};

/** The event types each phase accepts; every other pair must throw. */
const VALID: Readonly<Record<Phase, readonly MachineEvent["type"][]>> = {
  dealing: ["dealt", "session_ended"],
  opponent_acts: ["opponent_acted", "session_ended"],
  await_hero: ["hero_decided", "session_ended"],
  feedback: ["feedback_closed", "session_ended"],
  street_end: ["street_closed", "session_ended"],
  reveal: ["revealed", "session_ended"],
  hand_end: ["next_hand", "session_ended"],
  ended: [],
};

describe("R3.6 session state machine", () => {
  it.each(EDGES.map((edge) => [`${edge.from} -${edge.event.type}-> ${edge.to}`, edge] as const))(
    "R3.6 edge %s",
    (_name, edge) => {
      const before = at(edge.from, edge.stopRule);
      const after = transition(before, edge.event);
      expect(after.phase).toBe(edge.to);
      expect(after.stopRule).toBe(before.stopRule);
      expect(before.phase).toBe(edge.from);
    },
  );

  it("R3.6 the edge list covers every A6 section 2 transition", () => {
    const pairs = new Set(EDGES.map((edge) => `${edge.from}>${edge.to}`));
    const a6 = [
      "dealing>await_hero",
      "dealing>opponent_acts",
      "opponent_acts>await_hero",
      "opponent_acts>street_end",
      "await_hero>feedback",
      "feedback>opponent_acts",
      "feedback>street_end",
      "feedback>hand_end",
      "street_end>reveal",
      "street_end>hand_end",
      "reveal>await_hero",
      "reveal>opponent_acts",
      "hand_end>dealing",
      "hand_end>ended",
    ];
    for (const pair of a6) {
      expect(pairs.has(pair), pair).toBe(true);
    }
  });

  it("R3.6 the player may end a session from any phase but ended", () => {
    for (const phase of PHASES.filter((candidate) => candidate !== "ended")) {
      expect(transition(at(phase), { type: "session_ended" }).phase).toBe("ended");
    }
  });

  it("R3.6 every invalid phase and event pair throws InvalidTransitionError", () => {
    let invalid = 0;
    for (const phase of PHASES) {
      for (const type of EVENT_TYPES) {
        const event = SAMPLE_EVENTS[type];
        if (VALID[phase].includes(type)) {
          expect(() => transition(at(phase), event)).not.toThrow();
          continue;
        }
        invalid += 1;
        expect(() => transition(at(phase), event), `${phase} ${type}`).toThrow(InvalidTransitionError);
      }
    }
    const validPairs = Object.values(VALID).reduce((sum, types) => sum + types.length, 0);
    expect(invalid).toBe(PHASES.length * EVENT_TYPES.length - validPairs);
    expect(invalid).toBeGreaterThan(0);
  });

  it("R3.6 the typed error names the phase and the event", () => {
    try {
      transition(at("ended"), { type: "next_hand" });
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const typed = error as InvalidTransitionError;
      expect([typed.phase, typed.eventType]).toEqual(["ended", "next_hand"]);
    }
  });

  it("R3.6 spot mode (after action) ends the hand after every feedback (05 section 4)", () => {
    for (const next of ["opponent", "street_end", "hand_end"] as const) {
      const after = transition(at("feedback", "after_action"), { type: "feedback_closed", next });
      expect(after.phase, next).toBe("hand_end");
    }
  });

  it("R3.6 street mode goes from street_end to hand_end without a reveal (05 sections 2 and 4)", () => {
    const fromFeedback = transition(at("feedback", "end_of_street"), { type: "feedback_closed", next: "opponent" });
    expect(fromFeedback.phase).toBe("opponent_acts");
    const atStreetEnd = transition(at("street_end", "end_of_street"), {
      type: "street_closed",
      handOver: false,
      nextStreet: true,
    });
    expect(atStreetEnd.phase).toBe("hand_end");
  });

  it("R3.6 full-hand mode passes street_end, reveal and hand_end when the v1 flop is dealt", () => {
    const path: MachineEvent[] = [
      { type: "feedback_closed", next: "street_end" },
      { type: "street_closed", handOver: false, nextStreet: true },
      { type: "revealed", next: "none" },
      { type: "next_hand" },
    ];
    const phases = path.reduce<Phase[]>(
      (seen, event) => [...seen, transition(at(seen.at(-1) ?? "feedback", FULL_HAND), event).phase],
      ["feedback"],
    );
    expect(phases).toEqual(["feedback", "street_end", "reveal", "hand_end", "dealing"]);
  });

  it("R3.6 transition never mutates its input", () => {
    const state = Object.freeze(at("dealing"));
    const next = transition(state, { type: "dealt", heroToAct: true });
    expect(next).not.toBe(state);
    expect(state.phase).toBe("dealing");
  });

  it("R3.6 the stop rules are the drill schema's", () => {
    expect([...STOP_RULES]).toEqual(["after_action", "end_of_street", "end_of_hand"]);
  });
});
