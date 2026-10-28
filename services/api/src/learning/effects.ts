/**
 * The learning hooks (R4.10, R4.11, R4.13, R4.14, O-27, O-272 to O-279): where the S31 lanes plug
 * their writes into S23's decision and session-end transactions, so every learning write commits
 * or rolls back with the attempt or the end it belongs to.
 *
 * Mechanism: each lane exports one LearningHookPart (learning/hooks.ts lists them, in the order
 * shared effects, automated, holdout); composeLearningHooks turns the list into one LearningHooks,
 * which buildApp decorates the app with (tests may inject their own through BuildAppOptions).
 * - prepare (PR #27 review HIGH 3, MEDIUM 12) runs before the decision's or the end's transaction
 *   opens, outside any lock (learning/prepare.ts prepareLearning). It loads the class catalog once
 *   when any part needsCatalog (null when it cannot load, never an exception) and then each part's
 *   own prepare, whose result lands in prepared.parts under the part's name. Every hook below reads
 *   it as context.prepared, so no hook loads the catalog or calls a slow upstream under the lock.
 * - beforeGrade runs in the decision transaction after the session row is locked, before grading.
 *   Each part returns overrides of learning's GradeInput (mode, firstAttempt, panelsRevealed,
 *   ratedTodayInTrack) and of the attempt row (trackIds, itemDifficulty); later parts win per key.
 *   Absent keys keep S23's drill defaults (grading/policy.ts buildGradeInput; ratedTodayInTrack
 *   from countRatedToday; track_ids empty; item_difficulty null).
 * - afterInsert runs after the attempt row is inserted, before the session state is written. Each
 *   part sees `next`, the state about to be written with the earlier parts' patches applied, and
 *   returns a state patch (learning, spots) and feedback extras (review_block); later parts win
 *   per key. Parts run in list order, so a later part reads what an earlier one wrote in the same
 *   transaction (the automated next pick sees the block close's cards).
 * - onSessionEnd runs in the end transaction after ended_at is written, and again, with firstEnd
 *   false, when an ended session is ended again: then it must write nothing and return the same
 *   extras (read back by session id), so a repeat end answers the same recap. Rating changes and
 *   unlocks concatenate across parts; the last tier wins.
 * - loadHoldoutGuard runs before a derivation (GET /next, POST decisions), read only; the guards of
 *   every part combine (any part holding a hand back holds it back).
 * Every part checks the session's mode itself (learningOf(session.state)); a drill session runs the
 * shared effects too.
 */
import type { GradeMode, GradeOutput } from "@g-tee-oh/learning";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { z } from "zod";

import type { ClassCatalog } from "../automated/class-catalog.js";
import type { Database } from "../db.js";
import type { FeedbackRow } from "../grading/feedback.js";
import type { feedbackSchema, recapSchema } from "../schemas/training.js";
import type { DerivedPrompt } from "../sessions/derive.js";
import { EMPTY_HOLDOUT_GUARD, type HoldoutGuard } from "../sessions/holdout-guard.js";
import type { SessionRow } from "../sessions/repository.js";
import type { PersistedState } from "../sessions/state.js";
import type { SolverQuery, SqGrade } from "../solver-query/client.js";

type Feedback = z.infer<typeof feedbackSchema>;
type Recap = z.infer<typeof recapSchema>;

/** What prepareLearning read before the transaction opened (PR #27 review HIGH 3). */
export interface PreparedLearning {
  /** The all-configs class catalog (scopeCatalog cuts a session's scope); null when it could not load. */
  catalog: ClassCatalog | null;
  /** Each part's own prepare result, by part name; a part narrows its own entry. */
  parts: Readonly<Record<string, unknown>>;
}

/** Nothing prepared: no catalog, no part results. */
export const EMPTY_PREPARED_LEARNING: PreparedLearning = Object.freeze({ catalog: null, parts: Object.freeze({}) });

/**
 * What the prepared context is for: a decision (beforeGrade, afterInsert) or an end (onSessionEnd),
 * so a part prepares only what its hooks will read (the holdout part replays the next item only for
 * a decision, PR #27 review HIGH 4).
 */
export type PreparePurpose = "decision" | "end";

/** What a part's prepare sees: no transaction, no lock; the catalog is already loaded (or null). */
export interface PrepareContext {
  /** The app's handle, outside any transaction. */
  database: Database;
  solverQuery: SolverQuery | null;
  userId: string;
  /** The session row as read before the transaction. */
  session: SessionRow;
  now: Date;
  catalog: ClassCatalog | null;
  purpose: PreparePurpose;
  /** Where a part logs what it handled without throwing (an upstream failure it turned into a value). */
  log: Pick<FastifyBaseLogger, "warn">;
}

/** One decision, inside its transaction, as every hook sees it. */
export interface DecisionContext {
  transaction: Database;
  now: Date;
  /** APP_TIME_ZONE, for day boundaries (O-247). */
  timeZone: string;
  userId: string;
  /** The session row as read before the transaction locked it (same version). */
  session: SessionRow;
  /** The await_hero derivation the decision answers: hand, node (with the hero's row) and roll. */
  derived: DerivedPrompt;
  /** solver-query's /v1/grade answer for the chosen action: the hand's difficulty_features (O-274). */
  grade: SqGrade;
  solverQuery: SolverQuery;
  /** The api request, for upstream headers (solver-port.ts). */
  request: FastifyRequest;
  /** Read before the transaction opened: the class catalog (or null) and each part's own results. */
  prepared: PreparedLearning;
}

/** What beforeGrade may change; an absent key keeps S23's default. */
export interface GradeOverrides {
  mode?: GradeMode;
  firstAttempt?: boolean;
  panelsRevealed?: boolean;
  ratedTodayInTrack?: number;
  /** attempt.track_ids (O-274). */
  trackIds?: readonly string[];
  /** attempt.item_difficulty (O-274). */
  itemDifficulty?: number | null;
  /**
   * Every action of the item is within the floor (O-274, shared effects): decide.ts's one post-grade
   * unrate step applies learning's withItemExclusion.
   */
  itemExcluded?: boolean;
  /**
   * A client-seeded automated session (PM seed condition, Lane A): the same post-grade step sets
   * rated false with learning's UNRATED_WEIGHT.
   */
  forceUnrated?: boolean;
}

/** The unrate flags OR across parts, so a later part can never undo an earlier unrate. */
const UNRATE_FLAGS = ["itemExcluded", "forceUnrated"] as const;

function mergeOverrides(left: GradeOverrides, right: GradeOverrides): GradeOverrides {
  const flags = Object.fromEntries(
    UNRATE_FLAGS.flatMap((flag) => (left[flag] === true || right[flag] === true ? [[flag, true]] : [])),
  ) as Pick<GradeOverrides, (typeof UNRATE_FLAGS)[number]>;
  return { ...left, ...right, ...flags };
}

export interface AfterInsertContext extends DecisionContext {
  /** The inserted attempt, as the feedback renders it. */
  attempt: FeedbackRow;
  outcome: GradeOutput;
  /** The merged overrides the decision was graded and stored with. */
  overrides: GradeOverrides;
  /** The state about to be written, with earlier parts' patches applied. */
  next: PersistedState;
}

/** State fields a hook may replace: the learning state and, for a new block, the hero spots. */
export type StatePatch = Partial<Pick<PersistedState, "learning" | "spots">>;
export type FeedbackExtras = Partial<Pick<Feedback, "review_block">>;

export interface AfterInsertResult {
  statePatch: StatePatch;
  feedbackExtras: FeedbackExtras;
}

export interface SessionEndContext {
  transaction: Database;
  now: Date;
  timeZone: string;
  userId: string;
  /** The row as locked before the end. */
  session: SessionRow;
  /** The row after ended_at was written. */
  ended: SessionRow;
  /** False when an ended session is ended again: write nothing, return the same extras. */
  firstEnd: boolean;
  /**
   * The solver-query client, for the class catalog the tier's effective weights need (O-271). Every
   * caller passes the app's (null when the api runs without one); a hook that needs it and finds
   * null throws the 503 problem, so the end rolls back (requireSolverQuery).
   */
  solverQuery: SolverQuery | null;
  /** Read before the transaction opened (prepareLearning): the class catalog (or null) and part results. */
  prepared: PreparedLearning;
}

export type RecapExtras = Partial<Pick<Recap, "rating_changes" | "tier" | "unlocks">>;

export interface HoldoutGuardContext {
  database: Database;
  userId: string;
  session: SessionRow;
}

/** One lane's hooks; every member is optional. */
export interface LearningHookPart {
  /** Names the part in logs and errors, for example "shared-effects". */
  name: string;
  /** True when the part reads context.prepared.catalog, so prepareLearning loads it. */
  needsCatalog?: boolean;
  /**
   * Runs before the transaction, outside the lock; its result is prepared.parts[name]. It must not
   * throw for a condition the hooks can handle (an upstream that cannot answer): return a value
   * that says so, so the decision or the end still commits (PR #27 review HIGH 3, HIGH 4).
   */
  prepare?(context: PrepareContext): Promise<unknown>;
  beforeGrade?(context: DecisionContext): Promise<GradeOverrides>;
  afterInsert?(context: AfterInsertContext): Promise<Partial<AfterInsertResult>>;
  onSessionEnd?(context: SessionEndContext): Promise<RecapExtras>;
  loadHoldoutGuard?(context: HoldoutGuardContext): Promise<HoldoutGuard>;
}

/** The composed hooks decide.ts and sessions/service.ts call. */
export interface LearningHooks {
  /** Whether any part reads the catalog (prepareLearning loads it only then). */
  needsCatalog: boolean;
  /** Every part's prepare, in order, as prepared.parts (prepareLearning calls it). */
  prepareParts(context: PrepareContext): Promise<Readonly<Record<string, unknown>>>;
  beforeGrade(context: DecisionContext): Promise<GradeOverrides>;
  afterInsert(context: AfterInsertContext): Promise<AfterInsertResult>;
  onSessionEnd(context: SessionEndContext): Promise<RecapExtras>;
  loadHoldoutGuard(context: HoldoutGuardContext): Promise<HoldoutGuard>;
}

export type DecisionEffects = Pick<LearningHooks, "beforeGrade" | "afterInsert">;
export type SessionEndEffects = Pick<LearningHooks, "onSessionEnd">;

function mergeRecapExtras(left: RecapExtras, right: RecapExtras): RecapExtras {
  const hasRatingChanges = left.rating_changes !== undefined || right.rating_changes !== undefined;
  const hasUnlocks = left.unlocks !== undefined || right.unlocks !== undefined;
  const tier = right.tier !== undefined ? right.tier : left.tier;
  return {
    ...(hasRatingChanges ? { rating_changes: [...(left.rating_changes ?? []), ...(right.rating_changes ?? [])] } : {}),
    ...(hasUnlocks ? { unlocks: [...(left.unlocks ?? []), ...(right.unlocks ?? [])] } : {}),
    ...(tier === undefined ? {} : { tier }),
  };
}

function anyGuard(guards: readonly HoldoutGuard[]): HoldoutGuard {
  if (guards.length === 0) {
    return EMPTY_HOLDOUT_GUARD;
  }
  return { isHeldOut: (solutionId, nodeKey, hand) => guards.some((guard) => guard.isHeldOut(solutionId, nodeKey, hand)) };
}

/** One LearningHooks over the parts, in order (see the module doc for the merge rules). */
export function composeLearningHooks(parts: readonly LearningHookPart[]): LearningHooks {
  return {
    needsCatalog: parts.some((part) => part.needsCatalog === true),
    async prepareParts(context) {
      const prepared: [string, unknown][] = [];
      for (const part of parts) {
        if (part.prepare !== undefined) {
          prepared.push([part.name, await part.prepare(context)]);
        }
      }
      return Object.freeze(Object.fromEntries(prepared));
    },
    async beforeGrade(context) {
      let overrides: GradeOverrides = {};
      for (const part of parts) {
        if (part.beforeGrade !== undefined) {
          overrides = mergeOverrides(overrides, await part.beforeGrade(context));
        }
      }
      return overrides;
    },
    async afterInsert(context) {
      let result: AfterInsertResult = { statePatch: {}, feedbackExtras: {} };
      for (const part of parts) {
        if (part.afterInsert !== undefined) {
          const next = { ...context.next, ...result.statePatch };
          const partial = await part.afterInsert({ ...context, next });
          result = {
            statePatch: { ...result.statePatch, ...partial.statePatch },
            feedbackExtras: { ...result.feedbackExtras, ...partial.feedbackExtras },
          };
        }
      }
      return result;
    },
    async onSessionEnd(context) {
      let extras: RecapExtras = {};
      for (const part of parts) {
        if (part.onSessionEnd !== undefined) {
          extras = mergeRecapExtras(extras, await part.onSessionEnd(context));
        }
      }
      return extras;
    },
    async loadHoldoutGuard(context) {
      const guards: HoldoutGuard[] = [];
      for (const part of parts) {
        if (part.loadHoldoutGuard !== undefined) {
          guards.push(await part.loadHoldoutGuard(context));
        }
      }
      return anyGuard(guards);
    },
  };
}

/** Hooks that change nothing: S23's behaviour exactly. */
export const NO_LEARNING_HOOKS: LearningHooks = composeLearningHooks([]);
