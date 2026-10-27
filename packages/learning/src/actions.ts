/**
 * The node's tree actions as the policy sees them (S22, ADR 0020): the spellings of the action
 * kinds and buckets, the check that an actions list matches the frequency list it describes, and
 * the passive-to-aggressive order the RNG bands follow (05 section 7, O-213). Nothing here
 * computes a bucket or a loss; both arrive from Rust (ADR 0004).
 */
import type { ActionKind, Bucket, GradeAction } from "./types.js";
import { isList, requireNonNegative, requireOneOf } from "./validate.js";

/** solver-query's ActionKind enum, in contract order. */
export const ACTION_KINDS: readonly ActionKind[] = Object.freeze([
  "fold",
  "check",
  "call",
  "limp",
  "straddle",
  "bet",
  "raise",
  "all_in",
]);

/** gto_model::Bucket::as_str, in Bucket::ALL order. */
export const BUCKETS: readonly Bucket[] = Object.freeze([
  "tiny",
  "small",
  "medium",
  "pot",
  "overbet-small",
  "overbet-large",
  "all-in",
]);

/**
 * Rank of each kind from passive to aggressive (05 section 7): fold, then the passive actions,
 * then bets and raises (ordered among themselves by size), all-in last.
 */
const KIND_RANK: Readonly<Record<ActionKind, number>> = Object.freeze({
  fold: 0,
  check: 1,
  call: 1,
  limp: 1,
  straddle: 1,
  bet: 2,
  raise: 2,
  all_in: 3,
});

/**
 * Checks an actions list against the frequency list it describes: one action per frequency, known
 * kinds and buckets, and finite non-negative sizes and losses. Throws a RangeError otherwise.
 */
export function requireActions(actions: readonly GradeAction[], actionCount: number): readonly GradeAction[] {
  if (!isList(actions)) {
    throw new RangeError("actions must be the node's actions list, one per frequency (O-210, O-213)");
  }
  if (actions.length !== actionCount) {
    throw new RangeError(`actions must list ${actionCount} actions, one per frequency, got ${actions.length}`);
  }
  actions.forEach((action, index) => {
    requireOneOf(action.kind, ACTION_KINDS, `actions[${index}].kind`);
    if (action.bucket !== null) {
      requireOneOf(action.bucket, BUCKETS, `actions[${index}].bucket`);
    }
    requireNonNegative(action.sizeCbb, `actions[${index}].sizeCbb`);
    requireNonNegative(action.lossPctPot, `actions[${index}].lossPctPot`);
  });
  return actions;
}

/**
 * The record indices of the actions sorted passive to aggressive: by kind rank, then by size, then
 * by record index, so the order is total and stable (O-213).
 */
export function passiveToAggressiveOrder(actions: readonly Pick<GradeAction, "kind" | "sizeCbb">[]): number[] {
  return actions
    .map((action, index) => ({ index, rank: KIND_RANK[action.kind], size: action.sizeCbb }))
    .sort((a, b) => a.rank - b.rank || a.size - b.size || a.index - b.index)
    .map((entry) => entry.index);
}
