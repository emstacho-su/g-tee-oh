/**
 * POST /sessions in holdout mode (R4.13, O-100, O-276, the PM seed condition): a monthly retest of
 * the holdout items, unrated.
 *
 * Mechanism:
 * - A body with a seed is a 400: a client-chosen seed with a pure GET /next would let anyone
 *   preview the items' hands, so the seed is always 64 random bits from node:crypto.
 * - The scope is the body's track_key, or every track. No drawn item in scope is a 422
 *   no-holdout-items (the draw job has not recorded that track yet).
 * - In one transaction: the month's round (APP_TIME_ZONE, O-247) is opened unless it exists (the
 *   monthly job may have opened it); the round's unanswered items are put in the seeded serving
 *   order; the first one that still replays (holdout/session-items.ts) becomes the hand to serve.
 *   None unanswered is a 409 holdout-complete; none replaying is a 422 no-holdout-items.
 * - The session is written with state.learning of kind holdout (round, track, remaining ids in
 *   serving order, answered and total in scope, current item) and the current item's spot pinned to
 *   its stored deal, so each hand replays the item exactly (deal-hand.ts). Settings are fixed: stop
 *   rule after_action, standard grouping, no RNG, no panel that reveals the answer. Decisions grade
 *   with mode holdout, so they are never rated (holdout/effects.ts).
 */
import { loadClassCatalog } from "../../automated/class-catalog.js";
import { drawPort } from "../../holdout/draw-port.js";
import { answeredItemIds, holdoutItems, openRound } from "../../holdout/repository.js";
import { firstServable, servingOrder } from "../../holdout/session-items.js";
import { requireDatabase } from "../../http/database.js";
import { idempotentWrite } from "../../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import { trainerSettingsSchema, type TrainerSettings } from "../../schemas/drills.js";
import { requireSolverQuery } from "../../solver-query/client.js";
import { localDay, monthOf } from "../../streaks/calendar.js";
import { newSessionSeed } from "../randomness.js";
import { insertSession } from "../repository.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import { toSession, type Session } from "../session-view.js";
import type { SessionSpot } from "../spot.js";
import { initialState, type HoldoutLearning } from "../state.js";

/** solver-query time one holdout create or advance may spend replaying items (a few calls per skipped item). */
export const HOLDOUT_REPLAY_DEADLINE_MS = 10_000;

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

export function noHoldoutItemsProblem(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noHoldoutItems, { detail });
}

export function holdoutCompleteProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.holdoutComplete, {
    detail: "Every holdout item of this month's round is answered; the next round opens next month.",
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

export async function createHoldoutSession(call: SessionCall, body: SessionCreateBody, clock: HoldoutClock): Promise<Session> {
  refuseSeed(body);
  const database = requireDatabase(call.app);
  const solverQuery = requireSolverQuery(call.app);
  const trackKey = body.track_key ?? null;
  const items = await holdoutItems(database, trackKey);
  if (items.length === 0) {
    throw noHoldoutItemsProblem("No holdout items are drawn for this scope yet; the draw runs once a track is covered.");
  }
  const catalog = await loadClassCatalog(solverQuery, database);
  const port = drawPort(solverQuery, call.request.id, HOLDOUT_REPLAY_DEADLINE_MS);
  const seed = newSessionSeed();
  const month = monthOf(localDay(clock.now, clock.timeZone));
  return idempotentWrite(call.app, call.request, HTTP_STATUS.created, async (transaction) => {
    const round = await openRound(transaction, call.userId, month, clock.now);
    const answered = await answeredItemIds(transaction, call.userId, round.id);
    const unanswered = items.filter((item) => !answered.has(item.id));
    if (unanswered.length === 0) {
      throw holdoutCompleteProblem();
    }
    const first = await firstServable(servingOrder(unanswered, seed), catalog, port);
    if (first === undefined) {
      throw noHoldoutItemsProblem("None of this round's unanswered items replays in the current library.");
    }
    const learning: HoldoutLearning = {
      kind: "holdout",
      round_id: round.id,
      round_month: round.month,
      track_key: trackKey,
      remaining: first.rest.map((item) => item.id),
      answered: items.length - unanswered.length,
      total: items.length,
      current_item: first.item.id,
    };
    const state = initialState(seed, [first.spot], HOLDOUT_SESSION_SPOT, learning);
    const row = await insertSession(transaction, { userId: call.userId, mode: "holdout", drillId: null, settings: HOLDOUT_SETTINGS, state });
    return toSession(row);
  });
}
