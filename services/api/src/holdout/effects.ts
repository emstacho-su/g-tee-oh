/**
 * The holdout, streak and unlock hook part (R4.13, R4.14, O-276, O-278, O-279, the PM seed
 * condition), registered last in learning/hooks.ts (after the shared effects and the automated loop).
 *
 * - needsCatalog: the session-end tier reads context.prepared.catalog (loaded before the end's
 *   transaction); nothing here loads the catalog under a lock (PR #27 review HIGH 3).
 * - prepare, a holdout session's decision (PR #27 review HIGH 4): before the decision transaction
 *   opens, the next item to serve is searched in the round's fixed order after the item being
 *   answered (holdout/serving.ts), each replay call under its own deadline. A replay failure is never
 *   an exception, so the decision always commits: a deterministic one makes the item unservable, a
 *   transient one stops the search with the item unresolved (O-334).
 * - beforeGrade: a holdout session's decision grades with mode holdout, so learning never rates it.
 * - afterInsert:
 *   - holdout session: the answered item gets its holdout_result (answered, with the round), the
 *     items the prepare found unservable get theirs, and the session moves to the prepared next
 *     item, whose spot, pinned to the item's stored deal, replaces the hero spots. With no next item
 *     the session is done (current_item null); when the search's budget ran out or a transient
 *     failure stopped it (O-334) before one replayed, the untried items stay in `remaining` and stay
 *     unresolved, so the session's next derivation is a 503 and a new create resumes at them.
 *     Holdout decisions write no other learning state (O-274).
 *   - unseeded automated session, rated decision: the streak day counts it and streak cosmetics
 *     unlock (streaks/repository.ts recordRatedDecision).
 * - onSessionEnd:
 *   - holdout session, first end: the item it served and never answered is skipped (score 0, PR #27
 *     review HIGH 1); a create that replaces the session ends it through the same path.
 *   - unseeded automated session: the overall tier after the session, from the prepared catalog's
 *     effective weights (O-271), with the tier cosmetics it reaches, and every cosmetic the session
 *     unlocked. No prepared catalog is a 503 before this part writes, so the end rolls back and a
 *     tier is never silently missing (the idle closer retries). A repeat end writes nothing.
 * - loadHoldoutGuard: drill and automated sessions hold back every holdout item (holdout/guard.ts).
 *   A holdout session deals its own items, so it holds nothing back; once it has no current item
 *   every derivation of it answers 409 holdout-complete (or 503 when items are left untried).
 */
import type {
  AfterInsertContext,
  DecisionContext,
  HoldoutGuardContext,
  LearningHookPart,
  PrepareContext,
  SessionEndContext,
} from "../learning/effects.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { EMPTY_HOLDOUT_GUARD } from "../sessions/holdout-guard.js";
import { holdoutCompleteProblem } from "../sessions/modes/holdout.js";
import { learningOf, type HoldoutLearning, type PersistedState } from "../sessions/state.js";
import { recordRatedDecision, sessionUnlocks, tierUnlocks } from "../streaks/repository.js";
import { loadHoldoutGuard } from "./guard.js";
import { roundById } from "./repository.js";
import { HOLDOUT_OUTCOMES, insertResults } from "./results.js";
import { searchServable, servingPlan, unservableResults, type ServingScope } from "./serving.js";
import type { ServingSearch } from "./session-items.js";

export const HOLDOUT_PART_NAME = "holdout";
const PREPARED_KIND = "holdout-next";

/** The holdout part's prepared result: where the session goes after this decision. */
interface HoldoutPrepared {
  kind: typeof PREPARED_KIND;
  scope: ServingScope;
  search: ServingSearch;
}

function isHoldoutPrepared(value: unknown): value is HoldoutPrepared {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === PREPARED_KIND;
}

function holdoutOf(state: Pick<PersistedState, "learning">): HoldoutLearning | null {
  const learning = learningOf(state);
  return learning?.kind === "holdout" ? learning : null;
}

function unseededAutomated(state: Pick<PersistedState, "learning">): boolean {
  const learning = learningOf(state);
  return learning?.kind === "automated" && !learning.seeded;
}

function unavailable(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, { detail });
}

async function prepare(context: PrepareContext): Promise<HoldoutPrepared | null> {
  const learning = holdoutOf(context.session.state);
  if (context.purpose !== "decision" || learning === null || learning.current_item === null || context.solverQuery === null) {
    return null;
  }
  const round = await roundById(context.database, context.userId, learning.round_id);
  const scope: ServingScope = { userId: context.userId, round, trackKey: learning.track_key };
  const plan = await servingPlan(context.database, scope, new Set([learning.current_item]));
  const search = await searchServable(plan.ordered, {
    solverQuery: context.solverQuery,
    requestId: `holdout-replay:${context.session.id}`,
    log: context.log,
  });
  return { kind: PREPARED_KIND, scope, search };
}

function beforeGrade(context: DecisionContext) {
  return Promise.resolve(holdoutOf(context.session.state) === null ? {} : { mode: "holdout" as const });
}

async function advanceHoldout(context: AfterInsertContext, learning: HoldoutLearning) {
  const { transaction, userId, now } = context;
  const current = learning.current_item;
  if (current === null) {
    throw holdoutCompleteProblem();
  }
  const prepared = context.prepared.parts[HOLDOUT_PART_NAME];
  if (!isHoldoutPrepared(prepared)) {
    throw unavailable("The next holdout item was not prepared (solver-query is not configured).");
  }
  const { scope, search } = prepared;
  await insertResults(transaction, [
    { userId, itemId: current, roundId: learning.round_id, takenAt: now, outcome: HOLDOUT_OUTCOMES.answered, attemptId: context.attempt.id },
    ...unservableResults(scope, search.unservable, now),
  ]);
  const next = search.next;
  const advanced: HoldoutLearning = {
    ...learning,
    answered: learning.answered + 1,
    remaining: (next?.rest ?? search.untried).map((item) => item.id),
    current_item: next?.item.id ?? null,
  };
  return { statePatch: next === undefined ? { learning: advanced } : { learning: advanced, spots: [next.spot] } };
}

async function afterInsert(context: AfterInsertContext) {
  const learning = holdoutOf(context.next);
  if (learning !== null) {
    return advanceHoldout(context, learning);
  }
  if (unseededAutomated(context.next) && context.attempt.rated) {
    await recordRatedDecision(context.transaction, { userId: context.userId, now: context.now, timeZone: context.timeZone });
  }
  return {};
}

/** HIGH 1: the item a holdout session served and never answered is skipped when the session ends. */
async function skipServedItem(context: SessionEndContext, learning: HoldoutLearning): Promise<void> {
  if (!context.firstEnd || learning.current_item === null) {
    return;
  }
  await insertResults(context.transaction, [
    { userId: context.userId, itemId: learning.current_item, roundId: learning.round_id, takenAt: context.now, outcome: HOLDOUT_OUTCOMES.skipped },
  ]);
}

async function onSessionEnd(context: SessionEndContext) {
  const holdout = holdoutOf(context.session.state);
  if (holdout !== null) {
    await skipServedItem(context, holdout);
    return {};
  }
  if (!unseededAutomated(context.session.state)) {
    return {};
  }
  const catalog = context.prepared.catalog;
  if (catalog === null) {
    throw unavailable("The class catalog could not load, so the session's tier cannot be computed; end it again.");
  }
  const { transaction, userId, ended } = context;
  const { tier } = await tierUnlocks(transaction, { userId, sessionId: context.session.id, catalog, write: context.firstEnd });
  const endedAt = ended.endedAt ?? context.now;
  return { tier, unlocks: await sessionUnlocks(transaction, userId, ended.startedAt, endedAt) };
}

async function loadGuard(context: HoldoutGuardContext) {
  const learning = holdoutOf(context.session.state);
  if (learning === null) {
    return loadHoldoutGuard(context.database);
  }
  if (learning.current_item === null) {
    if (learning.remaining.length > 0) {
      throw unavailable("The next holdout item could not be prepared in time; start a new holdout session to continue the round.");
    }
    throw holdoutCompleteProblem();
  }
  return EMPTY_HOLDOUT_GUARD;
}

export const HOLDOUT_HOOK_PART: LearningHookPart = {
  name: HOLDOUT_PART_NAME,
  needsCatalog: true,
  prepare,
  beforeGrade,
  afterInsert,
  onSessionEnd,
  loadHoldoutGuard: loadGuard,
};
