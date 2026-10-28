/**
 * Mocked automated and holdout sessions for the shots and mock projects (S32, R4.10, R4.12, O-264,
 * O-272, O-276, O-325, O-328), used by mock-sessions.ts for POST /sessions with mode automated or
 * holdout and for those sessions' next, decisions and end. Synthetic fixtures only
 * (src/fixtures/automated.ts).
 *
 * Mechanism: createAutomatedSessions keeps its own sessions. An automated session serves blocks of
 * FIXTURE_BLOCK_SIZE hands over the trainer fixture's hands, one decision per hand, cycling through
 * fixtureAutomatedBlocks: first a rated block (opens), then a worked example (O-272). Its prompts
 * carry the block's spot_class_key, track_key and worked_example; the session answers its first
 * block in PracticeSession.automated. A decision's feedback is rated outside worked examples
 * (and never when the body carried a seed, as the api does), and the decision that closes a block
 * carries its review_block. End answers a SessionRecap: one rating change per rated track (rated
 * for the first time, so before is null), a tier once something is rated, and the Tier II badge as
 * an unlock once a whole rated block was played. A holdout session refuses a seed with 400, starts
 * at the fixture round's progress, is never rated and ends with an empty recap. The checks match
 * the drill sessions': 409 stale-state for an old version, a replayed answer for a repeated
 * Idempotency-Key, 409 session-ended after the end. onEnd sees each recap the first time a session
 * ends (mock-app.ts moves the progress learner with it).
 */
import type { DecisionFeedback, Grouping, TrainerPrompt } from "../../src/contracts.js";
import {
  FIXTURE_BLOCK_SIZE,
  fixtureAutomatedBlocks,
  fixtureBlockPrompt,
  fixtureHoldoutProgress,
  fixtureHoldoutPrompt,
} from "../../src/fixtures/automated.js";
import { fixtureFollowedRoll, fixtureTrainerHands, type FixtureHand } from "../../src/fixtures/trainer.js";
import { GROUPINGS } from "../../src/store/session-defaults.js";
import type { TrackKey } from "../../src/progress/types.js";
import type { AutomatedBlock, PracticeSession, RatingChange, SessionRecap } from "../../src/trainer/session-types.js";
import { json, problem, type MockRequest, type MockResponse, type ProblemSpec } from "./mock-api.js";

export type MockTrainingMode = "automated" | "holdout";

export interface AutomatedSessionOptions {
  /** Called with the recap the first time an automated or holdout session ends. */
  readonly onEnd?: (recap: SessionRecap, mode: MockTrainingMode) => void;
}

export interface AutomatedSessions {
  /** POST /sessions with mode automated or holdout. */
  start(request: MockRequest): MockResponse;
  owns(id: string): boolean;
  /** next, decisions or end of a session this module owns. */
  route(request: MockRequest, id: string, action: string): MockResponse;
}

const PROBLEMS = {
  validation: { status: 400, slug: "validation", title: "Request validation failed" },
  stale: { status: 409, slug: "stale-state", title: "Stale state" },
  ended: { status: 409, slug: "session-ended", title: "Session ended" },
} as const satisfies Readonly<Record<string, ProblemSpec>>;

const STATUS = { ok: 200, created: 201 } as const;
const SESSION_ID_PREFIX = "00000000-0000-4000-8000-";
const SESSION_ID_DIGITS = 12;
const FIRST_SESSION_NUMBER = 0x200;
const STARTED_AT = "2026-10-27T12:00:00Z";
const ENDED_AT = "2026-10-27T12:20:00Z";
const NEXT_DUE = "2026-10-30T12:00:00Z";
const MAX_CONFIG_IDS = 32;
const IDEMPOTENCY_HEADER = "idempotency-key";
const BEST_SCORE = 1;
const CLOSED_P_KNOWN = 0.62;
/** Synthetic Glicko-2 figures for a track's first rating: the start, moved a little per decision. */
const START_MU = 1500;
const MU_PER_RATED = 9.5;
const START_RD = 330;
const RD_PER_RATED = 11;
const TIER_OVERALL = 1180;

interface Graded {
  readonly score: number;
  readonly evLossBb: number;
  readonly rated: boolean;
  readonly trackKey: TrackKey | null;
}

interface TrainingSession {
  readonly id: string;
  readonly mode: MockTrainingMode;
  readonly rng: boolean;
  /** The grouping the session grades with, from the start body; holdout is always standard. */
  readonly grouping: Grouping;
  readonly ratedEligible: boolean;
  readonly version: number;
  readonly graded: readonly Graded[];
  readonly replies: ReadonlyMap<string, MockResponse>;
  readonly recap: SessionRecap | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validConfigIds(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length >= 1 && value.length <= MAX_CONFIG_IDS && value.every((id) => typeof id === "string");
}

function blockAt(decision: number): AutomatedBlock {
  const block = fixtureAutomatedBlocks[Math.floor(decision / FIXTURE_BLOCK_SIZE) % fixtureAutomatedBlocks.length];
  if (block === undefined) throw new RangeError("the fixture has no automated blocks");
  return block;
}

function handAt(decision: number): FixtureHand {
  return fixtureTrainerHands[decision % fixtureTrainerHands.length] as FixtureHand;
}

function promptOf(session: TrainingSession): TrainerPrompt {
  const decision = session.graded.length;
  const base = session.mode === "automated" ? fixtureBlockPrompt(blockAt(decision), decision, session.id, session.version) : fixtureHoldoutPrompt(decision, session.version);
  return { ...base, session_id: session.id, rng_roll: session.rng ? handAt(decision).roll : null };
}

function reviewBlockOf(session: TrainingSession): DecisionFeedback["review_block"] {
  const decision = session.graded.length;
  if (session.mode !== "automated" || decision % FIXTURE_BLOCK_SIZE !== FIXTURE_BLOCK_SIZE - 1) return null;
  const block = blockAt(decision);
  return block.worked_example
    ? { spot_class_key: block.spot_class_key, closed: true, fsrs_grade: null, next_due: null, p_known: null }
    : { spot_class_key: block.spot_class_key, closed: true, fsrs_grade: "Good", next_due: NEXT_DUE, p_known: CLOSED_P_KNOWN };
}

function feedbackOf(session: TrainingSession, actionIndex: number): DecisionFeedback {
  const decision = session.graded.length;
  const hand = handAt(decision);
  const best = hand.feedback.best_action_indexes.includes(actionIndex);
  const graded = best ? { label: "best" as const, score: BEST_SCORE, ev_loss_bb: 0, ev_loss_pct_pot: 0 } : {};
  const worked = session.mode === "automated" && blockAt(decision).worked_example;
  const classKey = session.mode === "automated" ? blockAt(decision).spot_class_key : hand.feedback.spot_class_key;
  const roll = session.rng ? hand.roll : null;
  return {
    ...hand.feedback,
    ...graded,
    rated: session.ratedEligible && !worked,
    noise_flags: [],
    review_block: reviewBlockOf(session),
    spot_class_key: classKey,
    state_version: session.version + 1,
    rng_roll: roll,
    // The followed-the-roll mark, as the api stores it (O-371).
    followed_roll: fixtureFollowedRoll(promptOf(session), hand.feedback, actionIndex, roll, session.grouping),
  };
}

function ratingChanges(graded: readonly Graded[]): RatingChange[] {
  const tracks = [...new Set(graded.flatMap((entry) => (entry.rated && entry.trackKey !== null ? [entry.trackKey] : [])))];
  return tracks.map((track) => {
    const count = graded.filter((entry) => entry.rated && entry.trackKey === track).length;
    return { track_key: track, before: null, after: { mu: START_MU + MU_PER_RATED * count, rd: START_RD - RD_PER_RATED * count } };
  });
}

function recapOf(session: TrainingSession): SessionRecap {
  const { graded } = session;
  const rated = graded.filter((entry) => entry.rated);
  const changes = ratingChanges(graded);
  const wholeBlock = rated.length >= FIXTURE_BLOCK_SIZE;
  const blockedBy = changes.map((change) => change.track_key);
  return {
    session_id: session.id,
    ended_at: ENDED_AT,
    decisions: graded.length,
    rated_decisions: rated.length,
    mean_score: rated.length === 0 ? null : rated.reduce((sum, entry) => sum + entry.score, 0) / rated.length,
    ev_loss_bb_total: graded.reduce((sum, entry) => sum + entry.evLossBb, 0),
    rating_changes: changes,
    tier: rated.length === 0 ? null : { overall: TIER_OVERALL, tier: wholeBlock ? "II" : "I", band_tier: wholeBlock ? "III" : "I", blocked_by: wholeBlock ? blockedBy : [] },
    unlocks: wholeBlock ? ["badge-tier-II"] : [],
  };
}

/** The body's problem, or the new session's mode, RNG and rating eligibility. */
function parseStart(body: unknown): ProblemSpec | Pick<TrainingSession, "mode" | "rng" | "grouping" | "ratedEligible"> {
  if (!isRecord(body) || (body["mode"] !== "automated" && body["mode"] !== "holdout")) return PROBLEMS.validation;
  const seeded = body["seed"] !== undefined;
  if (body["mode"] === "holdout") return seeded ? PROBLEMS.validation : { mode: "holdout", rng: false, grouping: "standard", ratedEligible: false };
  if (!validConfigIds(body["config_ids"])) return PROBLEMS.validation;
  const settings = body["settings"];
  const rng = isRecord(settings) && settings["rng"] === true;
  const grouping = isRecord(settings) ? GROUPINGS.find((value) => value === settings["grouping"]) : undefined;
  return { mode: "automated", rng, grouping: grouping ?? "standard", ratedEligible: !seeded };
}

function sessionBody(session: TrainingSession): PracticeSession {
  const base = { session_id: session.id, mode: session.mode, drill_id: null, state: "await_hero" as const, state_version: session.version, started_at: STARTED_AT, rated_eligible: session.ratedEligible, grouping: session.grouping };
  return session.mode === "automated" ? { ...base, automated: blockAt(0), holdout: null } : { ...base, automated: null, holdout: fixtureHoldoutProgress };
}

export function createAutomatedSessions(options: AutomatedSessionOptions = {}): AutomatedSessions {
  let sessions: ReadonlyMap<string, TrainingSession> = new Map();
  let started = 0;

  function save(session: TrainingSession): void {
    sessions = new Map([...sessions, [session.id, session]]);
  }

  function decide(session: TrainingSession, request: MockRequest): MockResponse {
    const key = request.headers[IDEMPOTENCY_HEADER];
    const replay = key === undefined ? undefined : session.replies.get(key);
    if (replay !== undefined) return replay;
    const body = request.body;
    if (!isRecord(body) || !isNonNegativeInteger(body["state_version"]) || !isNonNegativeInteger(body["action_index"])) return problem(PROBLEMS.validation, request.path);
    if (body["state_version"] !== session.version) return problem(PROBLEMS.stale, request.path);
    const actionIndex = body["action_index"];
    if (!promptOf(session).buttons.some((button) => button.index === actionIndex)) return problem(PROBLEMS.validation, request.path);
    const feedback = feedbackOf(session, actionIndex);
    const response = json(STATUS.ok, feedback);
    const trackKey = session.mode === "automated" ? blockAt(session.graded.length).track_key : null;
    save({
      ...session,
      version: feedback.state_version,
      graded: [...session.graded, { score: feedback.score, evLossBb: feedback.ev_loss_bb, rated: feedback.rated, trackKey }],
      replies: key === undefined ? session.replies : new Map([...session.replies, [key, response]]),
    });
    return response;
  }

  function end(session: TrainingSession): MockResponse {
    if (session.recap !== null) return json(STATUS.ok, session.recap);
    const recap = recapOf(session);
    save({ ...session, recap });
    options.onEnd?.(recap, session.mode);
    return json(STATUS.ok, recap);
  }

  return {
    start(request) {
      const parsed = parseStart(request.body);
      if ("status" in parsed) return problem(parsed, request.path);
      const number = FIRST_SESSION_NUMBER + started;
      started += 1;
      const id = `${SESSION_ID_PREFIX}${number.toString(16).padStart(SESSION_ID_DIGITS, "0")}`;
      const session: TrainingSession = { id, ...parsed, version: 1, graded: [], replies: new Map(), recap: null };
      save(session);
      return json(STATUS.created, sessionBody(session));
    },
    owns: (id) => sessions.has(id),
    route(request, id, action) {
      const session = sessions.get(id);
      if (session === undefined) throw new RangeError(`no mocked training session ${id}`);
      if (action === "end") return end(session);
      if (session.recap !== null) return problem(PROBLEMS.ended, request.path);
      return action === "next" ? json(STATUS.ok, promptOf(session)) : decide(session, request);
    },
  };
}
