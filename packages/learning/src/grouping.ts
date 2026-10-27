/**
 * Grouping modes (05 section 6.4 rule 3, ADR 0020, R3.9, O-22, O-211). The trainer's buttons come
 * from the node's tree actions; the grouping mode decides which tree actions one button stands
 * for, and so which actions grade together.
 *
 * Mechanism: every action gets a group key. Standard keys each action by its record index, so a
 * group is one exact size. Grouped keys by kind and bucket on a postflop node, so a group is one
 * bucket (one size per bucket in a simple tree, ADR 0020; if a tree ever holds two, the bucket
 * grades by its best size); on a preflop node Grouped shows the exact size on every button (R3.9,
 * O-22), so it keys by record index exactly as Standard does and two preflop sizes in one bucket
 * never merge. Simple keys by action type: fold, check, call (a limp is a call of the big blind),
 * bet, raise; an all-in joins the node's bet or raise type, or stands alone when the node has
 * neither; a straddle stands alone. A group grades at its lowest-loss member (the best size of the
 * type), its frequency is the sum of its members', and the per-action losses arrive from Rust
 * (O-210, ADR 0004).
 */
import type { ActionKind, GradeAction, Grouping, Street } from "./types.js";
import { elementAt } from "./validate.js";

/** The Simple type of each kind before the all-in is placed (O-211). */
const SIMPLE_TYPE: Readonly<Record<ActionKind, string>> = Object.freeze({
  fold: "fold",
  check: "check",
  call: "call",
  limp: "call",
  straddle: "straddle",
  bet: "bet",
  raise: "raise",
  all_in: "all_in",
});

/** Group key part standing for "no bucket" in Grouped mode. */
const NO_BUCKET_KEY = "none";

/** The street where Grouped shows, and grades, exact sizes (R3.9, O-22). */
const EXACT_SIZE_STREET: Street = "preflop";

/** The bet or raise type an all-in joins in Simple mode: the node's aggressive type, if it has one. */
function aggressiveTypeOf(actions: readonly GradeAction[]): string | undefined {
  return actions.find((action) => action.kind === "bet" || action.kind === "raise")?.kind;
}

function simpleKeys(actions: readonly GradeAction[]): string[] {
  const aggressiveType = aggressiveTypeOf(actions);
  return actions.map((action) =>
    action.kind === "all_in" && aggressiveType !== undefined ? aggressiveType : SIMPLE_TYPE[action.kind],
  );
}

/** One key per record index: every action is its own group. */
export function exactKeys(actionCount: number): string[] {
  return Array.from({ length: actionCount }, (_, index) => String(index));
}

/** One group key per action, in record order, under the grouping mode and the node's street (O-211). */
export function groupKeys(actions: readonly GradeAction[], grouping: Grouping, street: Street): string[] {
  switch (grouping) {
    case "standard":
      return exactKeys(actions.length);
    case "grouped":
      return street === EXACT_SIZE_STREET
        ? exactKeys(actions.length)
        : actions.map((action) => `${action.kind}/${action.bucket ?? NO_BUCKET_KEY}`);
    case "simple":
      return simpleKeys(actions);
  }
}

/** Summed frequency per group key. */
export function groupFrequencies(keys: readonly string[], freqByAction: readonly number[]): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  keys.forEach((key, index) => {
    totals.set(key, (totals.get(key) ?? 0) + elementAt(freqByAction, index, "freqByAction"));
  });
  return totals;
}

/**
 * The member of the chosen action's group with the lowest loss: the action the group grades at
 * (05 section 6.4 rule 3). A tie with the chosen action keeps the chosen action; among other
 * members only a strictly lower loss wins, so the first in record order takes a tie.
 */
export function bestMemberOf(keys: readonly string[], actions: readonly GradeAction[], actionIndex: number): number {
  const chosenKey = elementAt(keys, actionIndex, "keys");
  const chosen = { index: actionIndex, lossPctPot: elementAt(actions, actionIndex, "actions").lossPctPot };
  return actions.reduce(
    (best, action, index) =>
      keys[index] === chosenKey && action.lossPctPot < best.lossPctPot ? { index, lossPctPot: action.lossPctPot } : best,
    chosen,
  ).index;
}
