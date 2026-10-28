/**
 * The holdout guard (R4.13, O-276): a held-out item is never served in a drill or automated hand.
 * The holdout lane implements the loader (holdout/guard.ts) that reads the global holdout_item set
 * once per request, read only, so GET /next stays write-free; the scaffold threads the guard
 * through DeriveSettings into deal-hand.ts tryDeal, which asks it after reading the hero's node with
 * solver-query's hand-space label of the hero's row (the hand class at a preflop node). A held-out
 * hand is dealt again by the existing deal-attempt loop (MAX_DEAL_ATTEMPTS). Holdout sessions deal
 * their item directly and load the empty guard.
 */
export interface HoldoutGuard {
  /** True when (solution, node, hand) is a holdout item; hand is the row label solver-query answers. */
  isHeldOut(solutionId: string, nodeKey: string, hand: string): boolean;
}

/** Holds nothing back: drills before the holdout lane, holdout sessions, and unit tests. */
export const EMPTY_HOLDOUT_GUARD: HoldoutGuard = { isHeldOut: () => false };
