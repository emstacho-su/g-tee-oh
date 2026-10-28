/**
 * POST /sessions/{id}/decisions (R3.7, A5 section 3, A6 sections 2 and 4, O-92, O-156, O-246,
 * O-248): grade one decision and persist it with the session's next state, all or nothing.
 *
 * Mechanism:
 * 1. Read the session (404 when it is not the user's, 409 session-ended, 409 stale-state when the
 *    body's state_version is not the persisted one), and derive its await_hero state exactly as
 *    GET /next does (sessions/derive.ts), so the decision answers the prompt the player saw. The
 *    action_index must be one of the node's actions (400).
 * 2. Grade with solver-query /v1/grade, timed into Server-Timing as sq-grade (O-248), with the
 *    reference `${session_id}:${state_version}` (O-156). In Grouped and Simple modes the policy may
 *    grade a group at another member (O-211); its loss in big blinds then comes from a second grade
 *    call for that member, so the stored EV loss is always Rust's (ADR 0004).
 * 3. In idempotentWrite's transaction (O-232): lock the session row, re-check its version, count
 *    ratedTodayInTrack (O-214, O-247), grade with learning's grade(); when that grades another
 *    member than step 2's preview (which passed ratedTodayInTrack 0), grade that member with
 *    solver-query too, so the stored member and its loss always belong together (PR #25 review
 *    MEDIUM 7; the call runs inside the transaction, bounded by the client timeout), insert the
 *    attempt row, move the state to feedback with state_version + 1 (an optimistic write), and
 *    render the feedback
 *    from the inserted row (O-92). Any failure rolls back the attempt with the state, and under an
 *    Idempotency-Key the stored response commits with them, so a retry replays it, graded once.
 * 4. S31 (O-27, O-272 to O-279): the learning hooks (learning/effects.ts) run inside that same
 *    transaction: beforeGrade after the lock (its overrides change the GradeInput, ratedTodayInTrack
 *    and the attempt's track_ids and item_difficulty), afterInsert after the attempt insert (its
 *    state patch is written with the next state, its extras join the feedback). The attempt also
 *    stores hand_class, the hero's row label at the node, and panels_revealed. The derivation loads
 *    the session's holdout guard first (sessions/derive-settings.ts).
 */
import {
  DIFFICULTY_BASE,
  UNRATED_WEIGHT,
  grade as gradeDecision,
  withItemExclusion,
  type GradeInput,
  type GradeOutput,
} from "@g-tee-oh/learning";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import type { AppConfig } from "../config.js";
import { requireDatabase } from "../http/database.js";
import { idempotentWrite } from "../http/idempotent-write.js";
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import { SQ_GRADE_METRIC, timed } from "../http/server-timing.js";
import type { decisionBodySchema } from "../schemas/training.js";
import type { DecisionContext, GradeOverrides } from "../learning/effects.js";
import { actionAt, afterHeroDecision, deriveAwaitHero, type DerivedPrompt } from "../sessions/derive.js";
import { deriveSettingsFor } from "../sessions/derive-settings.js";
import { findSession, lockSession, writeState, type SessionRow } from "../sessions/repository.js";
import { solverPort, type GradeCall, type SolverPort } from "../sessions/solver-port.js";
import { requireSolverQuery, type SqAction, type SqGrade } from "../solver-query/client.js";
import { countRatedToday, insertAttempt, staleStateProblem, type AttemptValues } from "./attempts.js";
import { renderFeedback, toContractLabel, type Feedback } from "./feedback.js";
import { bestActionIndexes, buildGradeInput, gradeActions, panelsRevealAnswer } from "./policy.js";
import { sessionEndedProblem } from "../sessions/problems.js";

export type DecisionBody = z.infer<typeof decisionBodySchema>;

/** The spot-class key stored for a node solver-query gives none (a configuration outside the catalog). */
export const UNCLASSIFIED_SPOT_CLASS = "unclassified";
/** The grade reference is opaque to solver-query and at most this long (O-156). */
const MAX_REFERENCE_LENGTH = 64;
/** ratedTodayInTrack does not change which action a group grades at, so the preview passes zero. */
const PREVIEW_RATED_TODAY = 0;

export interface DecisionRequest {
  app: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  config: AppConfig;
  userId: string;
  sessionId: string;
  body: DecisionBody;
  now: Date;
}

/** The group member the policy grades at and solver-query's loss for it, always fetched together. */
interface GradedMember {
  index: number;
  lossBb: number;
}

interface Graded {
  derived: DerivedPrompt;
  action: SqAction;
  chosen: SqGrade;
  member: GradedMember;
}

type GradeAt = (actionIndex: number) => Promise<SqGrade>;

export function sessionNotFound(): ProblemError {
  return new ProblemError(HTTP_STATUS.notFound, PROBLEM_SLUGS.notFound, { detail: "No session of yours has this id." });
}

function referenceOf(sessionId: string, stateVersion: number): string {
  return `${sessionId}:${stateVersion}`.slice(0, MAX_REFERENCE_LENGTH);
}

/** The GradeInput fields the learning hooks may override (learning/effects.ts). */
function gradeInputOverrides(overrides: GradeOverrides): Partial<Pick<GradeInput, "mode" | "firstAttempt" | "panelsRevealed">> {
  return {
    ...(overrides.mode === undefined ? {} : { mode: overrides.mode }),
    ...(overrides.firstAttempt === undefined ? {} : { firstAttempt: overrides.firstAttempt }),
    ...(overrides.panelsRevealed === undefined ? {} : { panelsRevealed: overrides.panelsRevealed }),
  };
}

function policyOutput(
  session: SessionRow,
  graded: Pick<Graded, "derived" | "chosen" | "action">,
  ratedToday: number,
  overrides: GradeOverrides = {},
): GradeOutput {
  const input = buildGradeInput({
    node: graded.derived.node,
    grade: graded.chosen,
    actionIndex: graded.action.index,
    rngRoll: graded.derived.roll?.roll ?? null,
    settings: session.settings,
    ratedTodayInTrack: ratedToday,
  });
  return unrateStep(gradeDecision({ ...input, ...gradeInputOverrides(overrides) }), overrides);
}

/**
 * The one post-grade step that unrates (learning/effects.ts GradeOverrides): an all-within-floor
 * item goes through learning's withItemExclusion (O-274); a client-seeded automated session is
 * rated false with UNRATED_WEIGHT (PM seed condition).
 */
export function unrateStep(output: GradeOutput, overrides: GradeOverrides): GradeOutput {
  const excluded = withItemExclusion(output, {
    difficulty: overrides.itemDifficulty ?? DIFFICULTY_BASE,
    excluded: overrides.itemExcluded === true,
  });
  return overrides.forceUnrated === true ? { ...excluded, rated: false, weight: UNRATED_WEIGHT } : excluded;
}

/**
 * The graded pair for member `index`: the one in hand, the chosen action's own loss, or a fresh
 * grade call for that member, so a stored loss always belongs to the stored member (PR #25 review
 * MEDIUM 7).
 */
export async function settleMember(graded: Graded, index: number, gradeAt: GradeAt): Promise<Graded> {
  if (index === graded.member.index) {
    return graded;
  }
  if (index === graded.action.index) {
    return { ...graded, member: { index, lossBb: graded.chosen.loss_bb } };
  }
  const member = await gradeAt(index);
  return { ...graded, member: { index, lossBb: member.loss_bb } };
}

function gradeAtFor(decision: DecisionRequest, port: SolverPort, call: Omit<GradeCall, "action_index">): GradeAt {
  return (actionIndex) => timed(decision.reply, SQ_GRADE_METRIC, () => port.grade({ ...call, action_index: actionIndex }));
}

async function gradeWithSolverQuery(session: SessionRow, decision: DecisionRequest, port: SolverPort): Promise<{ graded: Graded; gradeAt: GradeAt }> {
  const settings = await deriveSettingsFor(decision.app, decision.userId, session);
  const derived = await deriveAwaitHero(session.state, settings, port);
  const action = actionAt(derived.node, decision.body.action_index);
  if (action === undefined) {
    throw new ProblemError(HTTP_STATUS.badRequest, PROBLEM_SLUGS.badRequest, {
      detail: "action_index is not one of this node's actions.",
    });
  }
  const call = {
    solution_id: derived.hand.solution_id,
    node_key: derived.node.node_key,
    hand: derived.hand.hero_hand,
    reference: referenceOf(session.id, session.stateVersion),
  };
  const gradeAt = gradeAtFor(decision, port, call);
  const chosen = await gradeAt(action.index);
  const partial: Graded = { derived, action, chosen, member: { index: action.index, lossBb: chosen.loss_bb } };
  const previewIndex = policyOutput(session, partial, PREVIEW_RATED_TODAY).gradedActionIndex;
  return { graded: await settleMember(partial, previewIndex, gradeAt), gradeAt };
}

function attemptValues(
  session: SessionRow,
  decision: DecisionRequest,
  graded: Graded,
  outcome: GradeOutput,
  overrides: GradeOverrides,
): AttemptValues {
  const { chosen, derived, action, member } = graded;
  if (member.index !== outcome.gradedActionIndex) {
    throw new ProblemError(HTTP_STATUS.internal, PROBLEM_SLUGS.internal, { detail: "The graded member and its loss disagree." });
  }
  const actions = gradeActions(derived.node, chosen);
  const roll = derived.roll?.roll ?? null;
  return {
    userId: decision.userId,
    sessionId: session.id,
    solutionId: derived.hand.solution_id,
    nodeKey: derived.node.node_key,
    spotClassKey: derived.node.spot_class_key ?? UNCLASSIFIED_SPOT_CLASS,
    hand: derived.hand.hero_hand,
    actionIndex: action.index,
    actionToken: action.token,
    bucket: action.bucket ?? null,
    evChosenBb: chosen.ev_chosen_bb,
    evBestBb: chosen.ev_best_bb,
    evLossBb: graded.member.lossBb,
    evLossPctPot: chosen.loss_pct_pot_by_action[outcome.gradedActionIndex] ?? chosen.loss_pct_pot,
    floorPctPot: chosen.floor_pct_pot,
    score: outcome.score,
    label: toContractLabel(outcome.label),
    rngRoll: roll,
    confidence: decision.body.confidence ?? null,
    responseMs: decision.body.response_ms,
    rated: outcome.rated,
    weight: outcome.weight,
    noiseFlags: chosen.noise_flags,
    stateVersion: session.stateVersion,
    freqByAction: chosen.freq_by_action,
    evByAction: chosen.ev_by_action,
    lossPctPotByAction: chosen.loss_pct_pot_by_action,
    bestActionIndexes: bestActionIndexes(chosen.freq_by_action, actions, roll),
    gradedActionIndex: outcome.gradedActionIndex,
    handClass: derived.node.hands[0]?.hand ?? null,
    panelsRevealed: overrides.panelsRevealed ?? panelsRevealAnswer(session.settings),
    trackIds: overrides.trackIds ?? [],
    itemDifficulty: overrides.itemDifficulty ?? null,
  };
}

async function readForDecision(decision: DecisionRequest): Promise<SessionRow> {
  const session = await findSession(requireDatabase(decision.app), decision.userId, decision.sessionId);
  if (session === undefined) {
    throw sessionNotFound();
  }
  if (session.state.phase === "ended") {
    throw sessionEndedProblem();
  }
  if (session.stateVersion !== decision.body.state_version) {
    throw staleStateProblem();
  }
  return session;
}

/** Grades one decision and persists it with the next state in one transaction (R3.7). */
export async function submitDecision(decision: DecisionRequest): Promise<Feedback> {
  const session = await readForDecision(decision);
  const port = solverPort(requireSolverQuery(decision.app), decision.request);
  const preview = await gradeWithSolverQuery(session, decision, port);
  return idempotentWrite(decision.app, decision.request, HTTP_STATUS.ok, async (transaction) => {
    const locked = await lockSession(transaction, decision.userId, session.id);
    if (locked === undefined) {
      throw sessionNotFound();
    }
    if (locked.stateVersion !== session.stateVersion) {
      throw staleStateProblem();
    }
    const hooks = decision.app.learningHooks;
    const context: DecisionContext = {
      transaction,
      now: decision.now,
      timeZone: decision.config.timeZone,
      userId: decision.userId,
      session,
      derived: preview.graded.derived,
      grade: preview.graded.chosen,
      solverQuery: requireSolverQuery(decision.app),
      request: decision.request,
    };
    const overrides = await hooks.beforeGrade(context);
    const ratedToday =
      overrides.ratedTodayInTrack ?? (await countRatedToday(transaction, decision.userId, decision.now, decision.config.timeZone));
    const outcome = policyOutput(session, preview.graded, ratedToday, overrides);
    // The real ratedTodayInTrack may grade another member than the preview did: grade that one (MEDIUM 7).
    const graded = await settleMember(preview.graded, outcome.gradedActionIndex, preview.gradeAt);
    const row = await insertAttempt(transaction, attemptValues(session, decision, graded, outcome, overrides));
    const next = afterHeroDecision(graded.derived, graded.action, row.id, session.settings.stop_rule);
    const effects = await hooks.afterInsert({ ...context, attempt: row, outcome, overrides, next });
    const written = await writeState(transaction, {
      userId: decision.userId,
      sessionId: session.id,
      expectedVersion: session.stateVersion,
      state: { ...next, ...effects.statePatch },
    });
    if (written === undefined) {
      throw staleStateProblem();
    }
    return { ...renderFeedback(row), ...effects.feedbackExtras };
  });
}
