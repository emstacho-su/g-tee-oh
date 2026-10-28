/**
 * One action applied to a hand (R3.6, O-245): the history entry, the node the action leads to
 * (ActionView.next_node_key) and why the line stops when it leads nowhere. Shared by the deal walk
 * (deal-walk.ts) and the derivation (derive.ts).
 */
import type { SqAction, SqNode } from "../solver-query/client.js";
import type { HandState } from "./state.js";

export function actionAt(node: SqNode, index: number): SqAction | undefined {
  return node.actions.find((action) => action.index === index);
}

/** The hand after `position` took `action`: history, the node it leads to, and why the line stops (O-245). */
export function withAction(hand: HandState, position: HandState["hero_position"], action: SqAction): HandState {
  const next = action.next_node_key ?? null;
  const end = next === null ? (action.kind === "fold" ? "fold" : "street_closed") : null;
  return {
    ...hand,
    // The action is taken at the hand's current node, so its street is the hand's street (S38 review round 1).
    history: [...hand.history, { position, token: action.token, label: action.label, street: hand.street }],
    node_key: next,
    end,
    last_action_kind: action.kind,
  };
}
