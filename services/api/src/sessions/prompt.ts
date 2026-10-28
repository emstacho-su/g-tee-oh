/**
 * The trainer prompt (R3.6, A5 section 3, ADR 0020): the table at the hero's decision, rendered
 * from a derived state (derive.ts). The buttons are the node's tree actions as solver-query lists
 * them, so every button has an exact EV to grade against (ADR 0020, 05 section 6.4 rule 1); the pot,
 * stacks and street are solver-query's numbers, never recomputed (ADR 0004).
 */
import { PANEL_KEYS, type TrainerSettings } from "../schemas/drills.js";
import type { promptSchema } from "../schemas/training.js";
import { streetSchema } from "../schemas/common.js";
import { actionKindSchema } from "../schemas/study.js";
import type { SqAction } from "../solver-query/client.js";
import { trackFor } from "../learning/tracks.js";
import { cardsOf, type DerivedPrompt } from "./derive.js";
import { learningOf } from "./state.js";
import type { z } from "zod";

export type Prompt = z.infer<typeof promptSchema>;
export type NodeButton = Prompt["buttons"][number];

/** One tree action as a button (the NodeAction shape). */
export function toButton(action: SqAction): NodeButton {
  return {
    index: action.index,
    token: action.token,
    kind: actionKindSchema.parse(action.kind),
    size_cbb: action.size_cbb,
    bucket: action.bucket ?? null,
    label: action.label,
    next_node_key: action.next_node_key ?? null,
  };
}

/** The panels the trainer settings turn on, in the A7 order (O-235). */
export function visiblePanels(settings: TrainerSettings): string[] {
  return PANEL_KEYS.filter((key) => settings.panels[key] === true);
}

/** True on a worked-example block of an automated session (O-272). */
function workedExample(derived: DerivedPrompt): boolean {
  const learning = learningOf(derived.state);
  return learning?.kind === "automated" && learning.block.worked_example;
}

export function toPrompt(sessionId: string, stateVersion: number, derived: DerivedPrompt, settings: TrainerSettings): Prompt {
  const { hand, node, roll, state } = derived;
  return {
    session_id: sessionId,
    state: "await_hero",
    state_version: stateVersion,
    hero_position: hand.hero_position,
    hero_hand: cardsOf(hand.hero_hand),
    board: [...hand.board],
    pot_cbb: node.pot_cbb,
    stacks_cbb: [...node.stacks_cbb],
    history: hand.history.map((entry) => ({ ...entry })),
    buttons: node.actions.map(toButton),
    visible_panels: visiblePanels(settings),
    street: streetSchema.parse(node.street),
    rng_roll: roll === null ? null : roll.roll,
    previous_board: state.previous_board === null ? null : [...state.previous_board],
    synthetic: node.synthetic,
    // S31 (O-270, O-271): the class and its track come from solver-query's names for the node.
    spot_class_key: node.spot_class_key ?? null,
    track_key: trackFor(node.action_family ?? null, hand.hero_position),
    worked_example: workedExample(derived),
  };
}
