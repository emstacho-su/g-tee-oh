/**
 * The holdout, streak and unlock hook part (R4.13, R4.14, O-276, O-278, O-279, the PM seed
 * condition), registered last in learning/hooks.ts (after the shared effects and the automated loop).
 *
 * - beforeGrade: a holdout session's decision grades with mode holdout, so learning never rates it.
 * - afterInsert:
 *   - holdout session: the answered item gets its holdout_result (with the round), and the session
 *     moves to the next item in serving order that still replays (holdout/session-items.ts); its
 *     spot, pinned to the item's stored deal, replaces the hero spots. Holdout decisions write no
 *     other learning state (O-274): the shared and automated parts skip holdout sessions.
 *   - unseeded automated session, rated decision: the streak day counts it and streak cosmetics
 *     unlock (streaks/repository.ts recordRatedDecision).
 * - onSessionEnd, unseeded automated session: the overall tier after the session, from the class
 *   catalog's effective weights (O-271), with the tier cosmetics it reaches, and every cosmetic the
 *   session unlocked. The catalog needs solver-query; without it the end is a 503 and rolls back, so
 *   a tier is never silently missing. A repeat end recomputes the same tier and writes nothing.
 * - loadHoldoutGuard: drill and automated sessions hold back every holdout item (holdout/guard.ts).
 *   A holdout session deals its own items, so it holds nothing back; once its last item is answered
 *   (no current item) every derivation of it answers 409 holdout-complete, which is how GET /next and
 *   a late decision learn that the round is done.
 */
import { loadClassCatalog } from "../automated/class-catalog.js";
import type { AfterInsertContext, DecisionContext, HoldoutGuardContext, LearningHookPart, SessionEndContext } from "../learning/effects.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { EMPTY_HOLDOUT_GUARD } from "../sessions/holdout-guard.js";
import { holdoutCompleteProblem, HOLDOUT_REPLAY_DEADLINE_MS } from "../sessions/modes/holdout.js";
import { learningOf, type HoldoutLearning, type PersistedState } from "../sessions/state.js";
import type { SolverQuery } from "../solver-query/client.js";
import { recordRatedDecision, sessionUnlocks, tierUnlocks } from "../streaks/repository.js";
import { drawPort } from "./draw-port.js";
import { loadHoldoutGuard } from "./guard.js";
import { holdoutItems, insertResult } from "./repository.js";
import { firstServable } from "./session-items.js";

function holdoutOf(state: Pick<PersistedState, "learning">): HoldoutLearning | null {
  const learning = learningOf(state);
  return learning?.kind === "holdout" ? learning : null;
}

function unseededAutomated(state: Pick<PersistedState, "learning">): boolean {
  const learning = learningOf(state);
  return learning?.kind === "automated" && !learning.seeded;
}

function requireEndSolverQuery(solverQuery: SolverQuery | null): SolverQuery {
  if (solverQuery === null) {
    throw new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, {
      detail: "The solver-query service is not configured, so the session's tier cannot be computed.",
    });
  }
  return solverQuery;
}

function beforeGrade(context: DecisionContext) {
  return Promise.resolve(holdoutOf(context.session.state) === null ? {} : { mode: "holdout" as const });
}

async function advanceHoldout(context: AfterInsertContext, learning: HoldoutLearning) {
  const { transaction, userId, now } = context;
  if (learning.current_item === null) {
    throw holdoutCompleteProblem();
  }
  await insertResult(transaction, { userId, itemId: learning.current_item, attemptId: context.attempt.id, roundId: learning.round_id, takenAt: now });
  const remaining = new Set(learning.remaining);
  const ordered = (await holdoutItems(transaction, learning.track_key)).filter((item) => remaining.has(item.id));
  const byId = new Map(ordered.map((item) => [item.id, item]));
  const inOrder = learning.remaining.flatMap((id) => byId.get(id) ?? []);
  const catalog = await loadClassCatalog(context.solverQuery, transaction);
  const next = await firstServable(inOrder, catalog, drawPort(context.solverQuery, context.request.id, HOLDOUT_REPLAY_DEADLINE_MS));
  const advanced: HoldoutLearning = {
    ...learning,
    answered: learning.answered + 1,
    remaining: next === undefined ? [] : next.rest.map((item) => item.id),
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

async function onSessionEnd(context: SessionEndContext) {
  if (!unseededAutomated(context.session.state)) {
    return {};
  }
  const { transaction, userId, ended } = context;
  const catalog = await loadClassCatalog(requireEndSolverQuery(context.solverQuery), transaction);
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
    throw holdoutCompleteProblem();
  }
  return EMPTY_HOLDOUT_GUARD;
}

export const HOLDOUT_HOOK_PART: LearningHookPart = {
  name: "holdout",
  beforeGrade,
  afterInsert,
  onSessionEnd,
  loadHoldoutGuard: loadGuard,
};
