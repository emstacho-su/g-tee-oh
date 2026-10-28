/**
 * The automated loop's learning hook part (R4.10, O-272, O-274, O-215, the PM seed condition),
 * registered in learning/hooks.ts after the shared effects. It acts only on automated sessions.
 *
 * - beforeGrade: mode automated, first attempt by item, the per-track daily count, panels by block,
 *   and forceUnrated for a client-seeded session (learning/rated-rules.ts).
 * - afterInsert: the block serves one more hand and a confident miss joins the queue state's
 *   hypercorrection list (automated/block.ts). When the block has served its size, it is closed with
 *   the learning-state lane's closeReviewBlock (FSRS card and BKT mastery, O-272) BEFORE the next
 *   block is picked in the same transaction, so the reviewed class's new due date counts; the next
 *   block replaces the session's hero spots, and the feedback carries review_block. A seeded session
 *   writes no card or mastery: its closed block reports nulls, and its picks still run.
 * - onSessionEnd: a partial block is closed, then the session's rating period runs
 *   (rateSessionTracks); both are idempotent, so a repeat end (firstEnd false) only reads back the
 *   same rating changes. A seeded session rates and closes nothing.
 * The learning-state writers are injected (automatedHookPart), so tests can stand them in.
 */
import type { Database } from "../db.js";
import type { AfterInsertContext, DecisionContext, LearningHookPart, SessionEndContext } from "../learning/effects.js";
import { automatedGradeOverrides } from "../learning/rated-rules.js";
import { closeReviewBlock, type ReviewBlockExtras, type ReviewBlockInput } from "../learning-state/review-block.js";
import { rateSessionTracks, sessionRatingChanges, type RatingChange } from "../learning-state/rating-period.js";
import { insertCoverageRequests } from "../sessions/repository.js";
import { learningOf, type AutomatedLearning, type PersistedState } from "../sessions/state.js";
import { isBlockComplete, recordDecision, withBlock } from "./block.js";
import { chooseNextBlock, noClassProblem } from "./next-block.js";
import { blockAttempts, countEarlierAttemptsAtItem, countRatedTodayInTrack, type BlockAttempt } from "./repository.js";

/** What the automated part needs from the learning-state lane (S31-lanes.md cross-lane contracts). */
export interface LearningStateWriters {
  closeReviewBlock(transaction: Database, input: ReviewBlockInput): Promise<ReviewBlockExtras>;
  rateSessionTracks(transaction: Database, request: { userId: string; sessionId: string; now: Date }): Promise<RatingChange[]>;
  sessionRatingChanges(database: Database, request: { userId: string; sessionId: string }): Promise<RatingChange[]>;
}

const NO_LINE = null;

function automatedOf(state: Pick<PersistedState, "learning">): AutomatedLearning | null {
  const learning = learningOf(state);
  return learning?.kind === "automated" ? learning : null;
}

/** A closed block of a seeded session: nothing was written, so nothing is reported (PM seed condition). */
function unwrittenClose(spotClassKey: string): ReviewBlockExtras {
  return { spot_class_key: spotClassKey, closed: true, fsrs_grade: null, next_due: null, p_known: null };
}

async function beforeGrade(context: DecisionContext) {
  const learning = automatedOf(context.session.state);
  if (learning === null) {
    return {};
  }
  const { transaction, userId, derived } = context;
  const earlier = await countEarlierAttemptsAtItem(transaction, userId, {
    solutionId: derived.hand.solution_id,
    nodeKey: derived.node.node_key,
    handClass: derived.node.hands[0]?.hand ?? null,
  });
  const trackKey = learning.block.track_key;
  const ratedToday =
    trackKey === null ? null : await countRatedTodayInTrack(transaction, userId, trackKey, { now: context.now, timeZone: context.timeZone });
  return automatedGradeOverrides({
    seeded: learning.seeded,
    workedExample: learning.block.worked_example,
    earlierAttemptsAtItem: earlier,
    ratedTodayInTrack: ratedToday,
  });
}

function closeInput(context: { userId: string; now: Date }, learning: AutomatedLearning, attempts: readonly BlockAttempt[]): ReviewBlockInput {
  return {
    userId: context.userId,
    spotClassKey: learning.block.spot_class_key,
    workedExample: learning.block.worked_example,
    attempts: attempts.map((attempt) => ({ score: attempt.score, responseMs: attempt.responseMs, label: attempt.label })),
    now: context.now,
  };
}

function afterInsertWith(writers: LearningStateWriters) {
  return async (context: AfterInsertContext) => {
    const learning = automatedOf(context.next);
    if (learning === null) {
      return {};
    }
    const { transaction, userId, now } = context;
    const attempts = await blockAttempts(transaction, context.session.id, learning.block.served + 1);
    const recorded = recordDecision(learning, { label: context.outcome.label, confidence: attempts.at(-1)?.confidence ?? null });
    if (!isBlockComplete(recorded)) {
      return { statePatch: { learning: recorded } };
    }
    const reviewBlock = recorded.seeded
      ? unwrittenClose(recorded.block.spot_class_key)
      : await writers.closeReviewBlock(transaction, closeInput(context, recorded, attempts));
    const next = await chooseNextBlock(transaction, context.solverQuery, {
      userId,
      configIds: recorded.config_ids,
      seed: context.session.state.seed,
      pickNo: recorded.pick_no,
      queue: recorded.queue,
      now,
    });
    await insertCoverageRequests(transaction, userId, next.gaps, NO_LINE);
    if (next.pick === null) {
      throw noClassProblem(next.gaps.length);
    }
    return {
      statePatch: { learning: withBlock(recorded, next.pick), spots: next.pick.spots },
      feedbackExtras: { review_block: reviewBlock },
    };
  };
}

function onSessionEndWith(writers: LearningStateWriters) {
  return async (context: SessionEndContext) => {
    const learning = automatedOf(context.session.state);
    if (learning === null || learning.seeded) {
      return {};
    }
    const request = { userId: context.userId, sessionId: context.session.id };
    if (!context.firstEnd) {
      return { rating_changes: await writers.sessionRatingChanges(context.transaction, request) };
    }
    if (learning.block.served > 0) {
      const attempts = await blockAttempts(context.transaction, context.session.id, learning.block.served);
      await writers.closeReviewBlock(context.transaction, closeInput(context, learning, attempts));
    }
    return { rating_changes: await writers.rateSessionTracks(context.transaction, { ...request, now: context.now }) };
  };
}

/** The automated part over the given learning-state writers. */
export function automatedHookPart(writers: LearningStateWriters): LearningHookPart {
  return {
    name: "automated",
    beforeGrade,
    afterInsert: afterInsertWith(writers),
    onSessionEnd: onSessionEndWith(writers),
  };
}

/** The production part, over the learning-state lane's writers. */
export const AUTOMATED_HOOK_PART: LearningHookPart = automatedHookPart({ closeReviewBlock, rateSessionTracks, sessionRatingChanges });
