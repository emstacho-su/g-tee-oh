/**
 * The trainer's client state in spot mode (S25, R3.13, R3.11, O-284, O-198, O-232, A7 section 3).
 * Pure: no input/output, no clock and no randomness. The hook (use-spot-session.ts) reads the clock
 * and makes the Idempotency-Keys through injected dependencies and passes them in the events, so
 * the same state and event always give the same next state.
 *
 * States: idle (the start panel), starting (POST /sessions), loading_prompt (GET /next), stale (GET
 * /next again after a 409 stale-state), await_action, await_confidence (an action is chosen and
 * may still be replaced), submitting (POST decisions), feedback (the reveal, paused until Next),
 * ending (POST end), ended (the recap), and error (with the request to retry, or none).
 *
 * Rules:
 * - Only the feedback state holds a DecisionFeedback, and it is entered only from submitting on the
 *   decision response; submitting is entered only by the confidence tap. So nothing is revealed and
 *   no decision is sent before the tap (R3.11, O-284).
 * - response_ms is the active time from the prompt shown to the action committed (the last
 *   choose_action), never below zero; pause and resume (the explainer or a dialog over the screen)
 *   stop and restart that clock (response-timer.ts, O-284).
 * - One Idempotency-Key per decision, made at the tap; a retry after a transient failure resends
 *   the same pending decision with the same key, so a double submit is graded once (O-232). Only
 *   transient problems offer a retry (spot-problem.ts); after a fixed answer the screen offers End.
 * - Start from a failed start (the start panel shows Start again) reuses the failed request's key
 *   when the failure was transient and the RNG choice is unchanged, so a start whose answer was lost
 *   is not doubled; any other Start takes the event's new key. End after a failed end reuses the
 *   stored key until a recap arrives (the api answers an ended session's end with its recap).
 * - A 409 stale-state on a decision goes to stale, which reads /next again and shows a notice.
 * - A choose_action whose index is not one of the prompt's buttons (NodeAction.index, O-198) and
 *   any event a state does not list are illegal: transition returns the same state object, which
 *   is how the hook and the tests see that the event was ignored.
 */
import type { ConfidenceChoice } from "../components/trainer/index.js";
import type { DecisionFeedback, TrainerPrompt } from "../contracts.js";
import { activeMs, pauseTimer, resumeTimer, startTimer, type ResponseTimer } from "./response-timer.js";
import type { PracticeSession, SessionRecap } from "./session-types.js";
import { isRetryable, type SpotProblem } from "./spot-problem.js";

export type { SpotProblem } from "./spot-problem.js";
export type { ResponseTimer } from "./response-timer.js";

/** The started session and whether it runs in RNG mode (the start panel's switch, O-283). */
export interface SessionContext {
  readonly session: PracticeSession;
  readonly rng: boolean;
}

export interface PendingDecision {
  /** NodeAction.index of the chosen action (O-198). */
  readonly actionIndex: number;
  readonly confidence: ConfidenceChoice;
  readonly responseMs: number;
  readonly idempotencyKey: string;
  readonly stateVersion: number;
}

export interface StartRequest {
  readonly key: string;
  readonly rng: boolean;
}

export type RetryTarget = "start" | "next" | "decision" | "end";
export type PromptNotice = "stale";

export type SpotState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly key: string; readonly rng: boolean }
  | { readonly kind: "loading_prompt"; readonly context: SessionContext; readonly version: number | null }
  | { readonly kind: "stale"; readonly context: SessionContext }
  | {
      readonly kind: "await_action";
      readonly context: SessionContext;
      readonly prompt: TrainerPrompt;
      readonly timer: ResponseTimer;
      readonly notice: PromptNotice | null;
    }
  | {
      readonly kind: "await_confidence";
      readonly context: SessionContext;
      readonly prompt: TrainerPrompt;
      readonly timer: ResponseTimer;
      readonly actionIndex: number;
      /** The active time from shown to this choice (O-284). */
      readonly responseMs: number;
    }
  | { readonly kind: "submitting"; readonly context: SessionContext; readonly prompt: TrainerPrompt; readonly decision: PendingDecision }
  | {
      readonly kind: "feedback";
      readonly context: SessionContext;
      readonly prompt: TrainerPrompt;
      readonly decision: PendingDecision;
      readonly feedback: DecisionFeedback;
    }
  | { readonly kind: "ending"; readonly context: SessionContext; readonly key: string }
  | { readonly kind: "ended"; readonly recap: SessionRecap }
  | {
      readonly kind: "error";
      readonly problem: SpotProblem;
      readonly retry: RetryTarget | null;
      readonly context: SessionContext | null;
      readonly prompt: TrainerPrompt | null;
      readonly decision: PendingDecision | null;
      readonly start: StartRequest | null;
      /** The failed end request's key, reused by its retry and by End until a recap arrives. */
      readonly key: string | null;
    };

export type SpotStateKind = SpotState["kind"];

export type SpotEvent =
  | { readonly type: "start"; readonly key: string; readonly rng: boolean }
  | { readonly type: "session_started"; readonly session: PracticeSession }
  | { readonly type: "prompt_loaded"; readonly prompt: TrainerPrompt; readonly at: number }
  | { readonly type: "choose_action"; readonly actionIndex: number; readonly at: number }
  | { readonly type: "confidence"; readonly confidence: ConfidenceChoice; readonly key: string }
  | { readonly type: "decision_succeeded"; readonly feedback: DecisionFeedback }
  | { readonly type: "next" }
  | { readonly type: "end"; readonly key: string }
  | { readonly type: "ended"; readonly recap: SessionRecap }
  | { readonly type: "failed"; readonly problem: SpotProblem }
  | { readonly type: "retry" }
  | { readonly type: "reset" }
  | { readonly type: "pause"; readonly at: number }
  | { readonly type: "resume"; readonly at: number };

export const INITIAL_SPOT_STATE: SpotState = { kind: "idle" };

type ErrorState = Extract<SpotState, { kind: "error" }>;
type AwaitState = Extract<SpotState, { kind: "await_action" | "await_confidence" }>;

const EMPTY_ERROR = { prompt: null, decision: null, start: null, key: null } as const;

function errorState(problem: SpotProblem, target: RetryTarget, rest: Partial<Omit<ErrorState, "kind" | "problem" | "retry">>): SpotState {
  return { kind: "error", problem, retry: isRetryable(problem) ? target : null, context: null, ...EMPTY_ERROR, ...rest };
}

function isAwaiting(state: SpotState): state is AwaitState {
  return state.kind === "await_action" || state.kind === "await_confidence";
}

function hasButton(prompt: TrainerPrompt, actionIndex: number): boolean {
  return prompt.buttons.some((button) => button.index === actionIndex);
}

function chooseAction(state: SpotState, event: Extract<SpotEvent, { type: "choose_action" }>): SpotState {
  if (!isAwaiting(state) || !hasButton(state.prompt, event.actionIndex)) return state;
  const { context, prompt, timer } = state;
  return { kind: "await_confidence", context, prompt, timer, actionIndex: event.actionIndex, responseMs: activeMs(timer, event.at) };
}

function retime(state: SpotState, update: (timer: ResponseTimer) => ResponseTimer): SpotState {
  if (!isAwaiting(state)) return state;
  const timer = update(state.timer);
  return timer === state.timer ? state : { ...state, timer };
}

function tapConfidence(state: SpotState, event: Extract<SpotEvent, { type: "confidence" }>): SpotState {
  if (state.kind !== "await_confidence") return state;
  const decision: PendingDecision = {
    actionIndex: state.actionIndex,
    confidence: event.confidence,
    responseMs: state.responseMs,
    idempotencyKey: event.key,
    stateVersion: state.prompt.state_version,
  };
  return { kind: "submitting", context: state.context, prompt: state.prompt, decision };
}

function promptLoaded(state: SpotState, event: Extract<SpotEvent, { type: "prompt_loaded" }>): SpotState {
  if (state.kind !== "loading_prompt" && state.kind !== "stale") return state;
  const notice = state.kind === "stale" ? "stale" : null;
  return { kind: "await_action", context: state.context, prompt: event.prompt, timer: startTimer(event.at), notice };
}

function failed(state: SpotState, problem: SpotProblem): SpotState {
  switch (state.kind) {
    case "starting":
      return errorState(problem, "start", { start: { key: state.key, rng: state.rng } });
    case "loading_prompt":
    case "stale":
      return errorState(problem, "next", { context: state.context });
    case "submitting":
      if (problem.kind === "stale") return { kind: "stale", context: state.context };
      return errorState(problem, "decision", { context: state.context, prompt: state.prompt, decision: state.decision });
    case "ending":
      return errorState(problem, "end", { context: state.context, key: state.key });
    default:
      return state;
  }
}

function retry(state: SpotState): SpotState {
  if (state.kind !== "error") return state;
  const { retry: target, context, prompt, decision, start, key } = state;
  if (target === "start" && start !== null) return { kind: "starting", key: start.key, rng: start.rng };
  if (target === "next" && context !== null) return { kind: "loading_prompt", context, version: null };
  if (target === "decision" && context !== null && prompt !== null && decision !== null) {
    return { kind: "submitting", context, prompt, decision };
  }
  if (target === "end" && context !== null && key !== null) return { kind: "ending", context, key };
  return state;
}

/** Start from idle, or again from a failed start (the start panel is showing). */
function start(state: SpotState, event: Extract<SpotEvent, { type: "start" }>): SpotState {
  if (state.kind === "idle") return { kind: "starting", key: event.key, rng: event.rng };
  if (state.kind !== "error" || state.context !== null) return state;
  const sameRequest = state.retry === "start" && state.start !== null && state.start.rng === event.rng;
  return { kind: "starting", key: sameRequest && state.start !== null ? state.start.key : event.key, rng: event.rng };
}

const ENDABLE: ReadonlySet<SpotStateKind> = new Set(["loading_prompt", "stale", "await_action", "await_confidence", "feedback", "error"]);

/** Whether End is possible: a session is running and no request of its own is under way. */
export function canEnd(state: SpotState): boolean {
  return ENDABLE.has(state.kind) && "context" in state && state.context !== null;
}

function end(state: SpotState, key: string): SpotState {
  if (!canEnd(state) || !("context" in state) || state.context === null) return state;
  const storedKey = state.kind === "error" ? state.key : null;
  return { kind: "ending", context: state.context, key: storedKey ?? key };
}

/** Back to the start panel after the recap, or from a failed start. */
function reset(state: SpotState): SpotState {
  if (state.kind === "ended" || (state.kind === "error" && state.context === null)) return INITIAL_SPOT_STATE;
  return state;
}

export function transition(state: SpotState, event: SpotEvent): SpotState {
  switch (event.type) {
    case "start":
      return start(state, event);
    case "session_started":
      return state.kind === "starting"
        ? { kind: "loading_prompt", context: { session: event.session, rng: state.rng }, version: event.session.state_version }
        : state;
    case "prompt_loaded":
      return promptLoaded(state, event);
    case "choose_action":
      return chooseAction(state, event);
    case "confidence":
      return tapConfidence(state, event);
    case "decision_succeeded":
      return state.kind === "submitting"
        ? { kind: "feedback", context: state.context, prompt: state.prompt, decision: state.decision, feedback: event.feedback }
        : state;
    case "next":
      return state.kind === "feedback" ? { kind: "loading_prompt", context: state.context, version: state.feedback.state_version } : state;
    case "end":
      return end(state, event.key);
    case "ended":
      return state.kind === "ending" ? { kind: "ended", recap: event.recap } : state;
    case "failed":
      return failed(state, event.problem);
    case "retry":
      return retry(state);
    case "reset":
      return reset(state);
    case "pause":
      return retime(state, (timer) => pauseTimer(timer, event.at));
    case "resume":
      return retime(state, (timer) => resumeTimer(timer, event.at));
  }
}
