/**
 * What a holdout session serves next (R4.13, O-276, PR #27 review HIGH 1 and HIGH 4), shared by a
 * create (sessions/modes/holdout.ts) and a decision's prepare phase (holdout/effects.ts).
 *
 * - servingPlan: the scope's items (one track or all), the user's resolutions in the round, and the
 *   unresolved items in the round's fixed order (session-items.ts roundOrder), so a create always
 *   resumes at the first unanswered item. `exclude` takes out items about to be resolved (the item a
 *   replaced session served, the item a decision is answering).
 * - searchServable: replays the ordered items until one is servable, before any transaction opens;
 *   each solver-query call has HOLDOUT_REPLAY_CALL_DEADLINE_MS and the search as a whole
 *   HOLDOUT_SERVING_BUDGET_MS (items the budget leaves untried stay unresolved). Every replay failure
 *   is logged at warn level with the item id. Only a deterministic one (a mismatch, a 4xx) makes the
 *   item unservable for the round; a transient one (a timeout, a network error, a 5xx or 503) stops
 *   the search and leaves the item unresolved for a later search (O-334).
 */
import type { FastifyBaseLogger } from "fastify";

import type { Database } from "../db.js";
import type { TrackKey } from "../learning/tracks.js";
import type { SolverQuery } from "../solver-query/client.js";
import { replayPort } from "./draw-port.js";
import { holdoutItems, type HoldoutItem, type HoldoutRound } from "./repository.js";
import { HOLDOUT_OUTCOMES, isScored, resolvedItems, type HoldoutOutcome, type NewResult } from "./results.js";
import { findServable, roundOrder, type ServingSearch } from "./session-items.js";

/** One solver-query call of a replay (PR #27 review HIGH 4: the deadline applies per request). */
export const HOLDOUT_REPLAY_CALL_DEADLINE_MS = 2_000;
/** A whole serving search: bounds how long a create or a decision waits before its transaction. */
export const HOLDOUT_SERVING_BUDGET_MS = 10_000;

export interface ServingScope {
  userId: string;
  round: HoldoutRound;
  /** One track, or null for every track. */
  trackKey: TrackKey | null;
}

export interface ServingPlan {
  /** Every item in scope. */
  items: HoldoutItem[];
  /** The user's resolutions in the round, every track. */
  resolved: ReadonlyMap<string, HoldoutOutcome>;
  /** The scope's unresolved items not excluded, in the round's serving order. */
  ordered: HoldoutItem[];
  /** The scope's items resolved with a score (answered or skipped). */
  scored: number;
}

const NOTHING_EXCLUDED: ReadonlySet<string> = new Set();

export async function servingPlan(database: Database, scope: ServingScope, exclude: ReadonlySet<string> = NOTHING_EXCLUDED): Promise<ServingPlan> {
  const items = await holdoutItems(database, scope.trackKey);
  const resolved = await resolvedItems(database, scope.userId, scope.round.id);
  const open = items.filter((item) => !resolved.has(item.id) && !exclude.has(item.id));
  const scored = items.filter((item) => {
    const outcome = resolved.get(item.id);
    return outcome !== undefined && isScored(outcome);
  }).length;
  return { items, resolved, ordered: roundOrder(open, scope.round.orderSeed), scored };
}

export interface SearchContext {
  solverQuery: SolverQuery;
  /** Names the caller in solver-query's logs. */
  requestId: string;
  log: Pick<FastifyBaseLogger, "warn">;
}

/** The first servable item of `ordered` (see the module doc). */
export async function searchServable(ordered: readonly HoldoutItem[], context: SearchContext): Promise<ServingSearch> {
  const budget = AbortSignal.timeout(HOLDOUT_SERVING_BUDGET_MS);
  const port = replayPort(context.solverQuery, context.requestId, { callDeadlineMs: HOLDOUT_REPLAY_CALL_DEADLINE_MS, budget });
  return findServable(ordered, port, {
    budget,
    onReplayError: (item, error) => {
      context.log.warn({ err: error, holdout_item_id: item.id }, "holdout item replay failed; unservable for this round");
    },
    onTransientError: (item, error) => {
      context.log.warn({ err: error, holdout_item_id: item.id }, "holdout item replay failed transiently; left unresolved");
    },
  });
}

/** The unservable resolutions of a search's failed items. */
export function unservableResults(scope: ServingScope, items: readonly HoldoutItem[], takenAt: Date): NewResult[] {
  return items.map((item) => ({ userId: scope.userId, itemId: item.id, roundId: scope.round.id, takenAt, outcome: HOLDOUT_OUTCOMES.unservable }));
}
