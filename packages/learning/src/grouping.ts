/**
 * Grouping modes (05 section 6.4 rule 3, ADR 0020, O-211). The trainer's buttons come from the
 * node's tree actions; the grouping mode decides which tree actions one button stands for, and
 * so which actions grade together.
 *
 * Mechanism: every action gets a group key. Standard keys each action by its record index, so a
 * group is one exact size. Grouped keys by kind and bucket, so a group is one bucket (one size per
 * bucket in a simple tree, ADR 0020; if a tree ever holds two, the bucket grades by its best
 * size). Simple keys by action type: fold, check, call (a limp is a call of the big blind), bet,
 * raise; an all-in joins the node's bet or raise type, or stands alone when the node has neither;
 * a straddle stands alone. A group grades at its lowest-loss member (the best size of the type),
 * its frequency is the sum of its members', and the group losses arrive from Rust per action
 * (O-210, ADR 0004).
 */
import type { ActionKind, GradeAction, Grouping } from "./types.js";

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

/** One group key per action, in record order, under the grouping mode (O-211). */
export function groupKeys(actions: readonly GradeAction[], grouping: Grouping): string[] {
  switch (grouping) {
    case "standard":
      return actions.map((_, index) => String(index));
    case "grouped":
      return actions.map((action) => `${action.kind}/${action.bucket ?? NO_BUCKET_KEY}`);
    case "simple":
      return simpleKeys(actions);
  }
}

/** Summed frequency per group key. */
export function groupFrequencies(keys: readonly string[], freqByAction: readonly number[]): ReadonlyMap<string, number> {
  return keys.reduce(
    (totals, key, index) => new Map(totals).set(key, (totals.get(key) ?? 0) + (freqByAction[index] ?? 0)),
    new Map<string, number>(),
  );
}

/**
 * The member of the chosen action's group with the lowest loss: the action the group grades at
 * (05 section 6.4 rule 3). A tie with the chosen action keeps the chosen action; among other
 * members only a strictly lower loss wins, so the first in record order takes a tie.
 */
export function bestMemberOf(keys: readonly string[], actions: readonly GradeAction[], actionIndex: number): number {
  const chosenKey = keys[actionIndex];
  return keys.reduce((best, key, index) => {
    if (key !== chosenKey) {
      return best;
    }
    const loss = actions[index]?.lossPctPot ?? Number.POSITIVE_INFINITY;
    const bestLoss = actions[best]?.lossPctPot ?? Number.POSITIVE_INFINITY;
    return loss < bestLoss ? index : best;
  }, actionIndex);
}
