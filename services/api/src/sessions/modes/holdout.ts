/**
 * POST /sessions in holdout mode (R4.13, O-100, O-276, the PM seed condition, PR #27 review HIGH 1
 * and HIGH 4): a monthly retest of the holdout items, unrated.
 *
 * Mechanism:
 * - A body with a seed is a 400: a client-chosen seed with a pure GET /next would let anyone
 *   preview the items' hands, so the session seed is always 64 random bits from node:crypto (and a
 *   holdout hand is pinned to its item's stored deal anyway).
 * - The scope is the body's track_key, or every track. No drawn item in scope is a 422
 *   no-holdout-items (the draw job has not recorded that track yet).
 * - The month's round (APP_TIME_ZONE, O-247) is opened unless it exists; its order seed fixes the
 *   order its items are served in, for every session of the round (holdout/session-items.ts).
 * - Before the transaction (HIGH 4): the scope's unresolved items in that order, less the item the
 *   user's open holdout session serves (it is about to be skipped), are replayed until one is
 *   servable (holdout/serving.ts); deterministic failures are recorded unservable for the round right
 *   away. None unresolved is a 409 holdout-complete, none replaying a 422 no-holdout-items, a spent
 *   budget or a transient failure a 503 that leaves the item unresolved (O-334).
 * - In one transaction (HIGH 1): the round row is locked, so a user's creates run one at a time;
 *   the user's open holdout session is ended through the shared end path (its served item is
 *   skipped, score 0); the prepared item must still be the first unresolved one in the order (else
 *   409 stale-state: create again); the session is written serving it. At most one holdout session
 *   per user is open (the partial unique index practice_session_open_holdout_key backs this up), so
 *   no one holds two items at once, and viewing then abandoning an item always uses it up.
 * - The session's state.learning (kind holdout) holds the round, the track, the current item, the
 *   unresolved items after it in order, and answered (scored) and total in scope; settings are
 *   fixed: stop rule after_action, standard grouping, no RNG, no panel that reveals the answer.
 *   Decisions grade with mode holdout, so they are never rated (holdout/effects.ts).
 */
import type { Database } from "../../db.js";
import { holdoutItems, lockRound, openHoldoutSessions, openRound } from "../../holdout/repository.js";
import { insertResults } from "../../holdout/results.js";
import { searchServable, servingPlan, unservableResults, type ServingScope } from "../../holdout/serving.js";
import type { ServableItem } from "../../holdout/session-items.js";
import { requireDatabase } from "../../http/database.js";
import { idempotentWrite } from "../../http/idempotent-write.js";
import { HTTP_STATUS, PG_ERROR, pgErrorCode, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import { trainerSettingsSchema, type TrainerSettings } from "../../schemas/drills.js";
import { requireSolverQuery } from "../../solver-query/client.js";
import { localDay, monthOf } from "../../streaks/calendar.js";
import { newSessionSeed } from "../randomness.js";
import { insertSession, type SessionRow } from "../repository.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import { toSession, type Session } from "../session-view.js";
import type { SessionSpot } from "../spot.js";
import { initialState, type HoldoutLearning } from "../state.js";

/** Fixed holdout settings: one decision per hand, graded exactly, nothing that shows the answer. */
export const HOLDOUT_SETTINGS: TrainerSettings = trainerSettingsSchema.parse({
  stop_rule: "after_action",
  input: "actions",
  grouping: "standard",
  rng: false,
  pause: "never",
  speed: "normal",
  quick_result: false,
  tables: 1,
  timebank_s: null,
  panels: {},
});

/** The session spot S23 dealing reads; a holdout hand is pinned to its item, so only hands matters (all). */
export const HOLDOUT_SESSION_SPOT: SessionSpot = { preflop_action: ["rfi"], hands: { mode: "all" }, alternate_seats: false };

export interface HoldoutClock {
  now: Date;
  timeZone: string;
}

/** Ends the user's open holdout session inside the create's transaction (sessions/service.ts endLockedSession). */
export type ReplaceOpenSession = (transaction: Database, sessionId: string) => Promise<void>;

const COMPLETE_DETAIL = "Every holdout item of this month's round is answered; the next round opens next month.";

export function noHoldoutItemsProblem(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noHoldoutItems, { detail });
}

export function holdoutCompleteProblem(detail: string = COMPLETE_DETAIL): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.holdoutComplete, { detail });
}

function roundMovedProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.staleState, {
    detail: "The holdout round moved on while this session was prepared; create it again.",
  });
}

function refuseSeed(body: SessionCreateBody): void {
  if (body.seed !== undefined) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
      detail: "A holdout session never takes a seed: its order and hands must not be previewable.",
      errors: [{ path: "body.seed", message: "not allowed in holdout mode" }],
    });
  }
}

/** The item the create will serve, found before its transaction (see the module doc). */
async function prepareFirstItem(call: SessionCall, scope: ServingScope, now: Date): Promise<ServableItem> {
  const database = requireDatabase(call.app);
  const replacing = (await openHoldoutSessions(database, scope.userId)).flatMap((session) => (session.currentItem === null ? [] : [session.currentItem]));
  const plan = await servingPlan(database, scope, new Set(replacing));
  if (plan.ordered.length === 0) {
    throw holdoutCompleteProblem(
      replacing.length > 0 ? "Your open holdout session serves the last unanswered item of this round; answer it there." : COMPLETE_DETAIL,
    );
  }
  const search = await searchServable(plan.ordered, { solverQuery: requireSolverQuery(call.app), requestId: call.request.id, log: call.request.log });
  await insertResults(database, unservableResults(scope, search.unservable, now));
  if (search.next !== undefined) {
    return search.next;
  }
  if (search.untried.length > 0) {
    throw new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, {
      detail: "solver-query could not replay a holdout item right now; try again.",
    });
  }
  throw noHoldoutItemsProblem("None of this round's unanswered items replays in the current library.");
}

async function insertHoldoutSession(transaction: Database, userId: string, learning: HoldoutLearning, first: ServableItem): Promise<SessionRow> {
  const state = initialState(newSessionSeed(), [first.spot], HOLDOUT_SESSION_SPOT, learning);
  try {
    return await insertSession(transaction, { userId, mode: "holdout", drillId: null, settings: HOLDOUT_SETTINGS, state });
  } catch (error: unknown) {
    // practice_session_open_holdout_key: another holdout session opened meanwhile (a create in another round).
    if (pgErrorCode(error) === PG_ERROR.uniqueViolation) {
      throw roundMovedProblem();
    }
    throw error;
  }
}

async function writeSession(transaction: Database, scope: ServingScope, first: ServableItem, replaceOpen: ReplaceOpenSession): Promise<Session> {
  const { round } = scope;
  await lockRound(transaction, round.id);
  for (const open of await openHoldoutSessions(transaction, scope.userId)) {
    await replaceOpen(transaction, open.id);
  }
  const settled = await servingPlan(transaction, scope);
  if (settled.ordered[0]?.id !== first.item.id) {
    throw roundMovedProblem();
  }
  const learning: HoldoutLearning = {
    kind: "holdout",
    round_id: round.id,
    round_month: round.month,
    track_key: scope.trackKey,
    remaining: settled.ordered.slice(1).map((item) => item.id),
    answered: settled.scored,
    total: settled.items.length,
    current_item: first.item.id,
  };
  return toSession(await insertHoldoutSession(transaction, scope.userId, learning, first));
}

export async function createHoldoutSession(call: SessionCall, body: SessionCreateBody, clock: HoldoutClock, replaceOpen: ReplaceOpenSession): Promise<Session> {
  refuseSeed(body);
  const database = requireDatabase(call.app);
  requireSolverQuery(call.app);
  const trackKey = body.track_key ?? null;
  if ((await holdoutItems(database, trackKey)).length === 0) {
    throw noHoldoutItemsProblem("No holdout items are drawn for this scope yet; the draw runs once a track is covered.");
  }
  const round = await openRound(database, call.userId, monthOf(localDay(clock.now, clock.timeZone)), clock.now);
  const scope: ServingScope = { userId: call.userId, round, trackKey };
  const first = await prepareFirstItem(call, scope, clock.now);
  return idempotentWrite(call.app, call.request, HTTP_STATUS.created, (transaction) => writeSession(transaction, scope, first, replaceOpen));
}
