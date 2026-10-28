/**
 * POST /sessions in automated mode (R4.10, O-270 to O-274, ADR 0018, the PM seed condition).
 *
 * Mechanism: the scope is the body's config_ids, or every catalog configuration (stored as an empty
 * list), cut from the one all-configs catalog (PR #27 review MEDIUM 6; buildApp subscribes its
 * coverage_added invalidation, MEDIUM 8). The first review block is chosen over the class catalog and the user's learning rows
 * (automated/next-block.ts): the catalog's uncovered pairs and the pairs of carded classes it no
 * longer lists are recorded as coverage_request rows (O-240), even when the session is refused
 * because no class is covered (422 no-coverage). The session is written in dealing phase at hand 0
 * with state.learning of kind automated (scope, pick counter 1, queue state, block) and the block's
 * class spots as its hero spots, so S23 dealing serves the block unchanged (O-272). Settings: stop
 * rule after_action, the body's grouping and rng, answer-revealing panels off (automated/settings.ts).
 *
 * Seed: the body's seed, or the app's newSessionSeed (64 random bits unless a test pins it). A
 * client-supplied seed marks the session seeded: every decision is unrated and no learning state is
 * written (the hook part honours it), while the class picks still run from the queue so the session
 * replays.
 */
import { chooseNextBlock, noClassProblem } from "../../automated/next-block.js";
import { loadClassCatalog } from "../../automated/class-catalog.js";
import { emptyLearningQueue } from "../../automated/queue.js";
import { AUTOMATED_SESSION_SPOT, automatedSettings } from "../../automated/settings.js";
import { requireDatabase } from "../../http/database.js";
import { idempotentWrite } from "../../http/idempotent-write.js";
import { HTTP_STATUS } from "../../http/problem.js";
import { requireSolverQuery } from "../../solver-query/client.js";
import { insertCoverageRequests, insertSession } from "../repository.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import { toSession, type Session } from "../session-view.js";
import { initialState, type AutomatedLearning } from "../state.js";

/** Coverage requests for whole pairs name no line. */
const NO_LINE = null;

export async function createAutomatedSession(call: SessionCall, body: SessionCreateBody, now: Date = new Date()): Promise<Session> {
  const database = requireDatabase(call.app);
  const solverQuery = requireSolverQuery(call.app);
  const configIds = [...new Set(body.config_ids ?? [])].sort();
  const seed = body.seed ?? call.app.newSessionSeed();
  const queue = emptyLearningQueue();
  // A scope naming a configuration the catalog does not serve is a 400 here (class-catalog.ts).
  const catalog = await loadClassCatalog(solverQuery, database, configIds.length === 0 ? undefined : configIds);
  const next = await chooseNextBlock(database, catalog, { userId: call.userId, configIds, seed, pickNo: 0, queue, now });
  if (next.pick === null) {
    await database.transaction().execute((transaction) => insertCoverageRequests(transaction, call.userId, next.gaps, NO_LINE));
    throw noClassProblem(next.gaps.length);
  }
  const learning: AutomatedLearning = {
    kind: "automated",
    seeded: body.seed !== undefined,
    config_ids: configIds,
    pick_no: next.pick.pickNo,
    queue: next.pick.queue,
    block: next.pick.block,
  };
  const state = initialState(seed, next.pick.spots, AUTOMATED_SESSION_SPOT, { learning, seeded: body.seed !== undefined });
  const settings = automatedSettings(body.settings);
  return idempotentWrite(call.app, call.request, HTTP_STATUS.created, async (transaction) => {
    await insertCoverageRequests(transaction, call.userId, next.gaps, NO_LINE);
    const row = await insertSession(transaction, { userId: call.userId, mode: "automated", drillId: null, settings, state });
    return toSession(row);
  });
}
