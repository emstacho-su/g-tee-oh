/**
 * The trainer's client state in spot mode (S25, R3.13, R3.11, O-284, O-198, A7 section 3). Pure:
 * no input/output, no clock and no randomness. The hook (use-spot-session.ts) reads the clock and
 * makes the Idempotency-Keys through injected dependencies and passes them in the events, so the
 * same state and event always give the same next state.
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
 * - response_ms runs from the prompt shown (prompt_loaded's time) to the action committed (the
 *   last choose_action's time), never below zero (O-284).
 * - One Idempotency-Key per decision, made at the tap; a retry after a network failure or a 503
 *   resends the same pending decision with the same key, so a double submit is graded once (O-232).
 *   The start and the end keep their keys for their retries the same way.
 * - A 409 stale-state on a decision goes to stale, which reads /next again and shows a notice.
 * - A choose_action whose index is not one of the prompt's buttons (NodeAction.index, O-198) and
 *   any event a state does not list are illegal: transition returns the same state object, which
 *   is how the hook and the tests see that the event was ignored.
 */
import type { ConfidenceChoice } from "../components/trainer/index.js";
import type { DecisionFeedback, TrainerPrompt } from "../contracts.js";
import type { PracticeSession, SessionRecap } from "./session-types.js";
import { isRetryable, type SpotProblem } from "./spot-problem.js";

export type { SpotProblem } from "./spot-problem.js";

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
      readonly shownAt: number;
      readonly notice: PromptNotice | null;
    }
  | {
      readonly kind: "await_confidence";
      readonly context: SessionContext;
      readonly prompt: TrainerPrompt;
      readonly shownAt: number;
      readonly actionIndex: number;
      readonly committedAt: number;
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
      /** The end request's key, for its retry. */
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
  | { readonly type: "reset" };

export const INITIAL_SPOT_STATE: SpotState = { kind: "idle" };

type ErrorState = Extract<SpotState, { kind: "error" }>;

const EMPTY_ERROR = { prompt: null, decision: null, start: null, key: null } as const;

function errorState(problem: SpotProblem, target: RetryTarget, rest: Partial<Omit<ErrorState, "kind" | "problem" | "retry">>): SpotState {
  return { kind: "error", problem, retry: isRetryable(problem) ? target : null, context: null, ...EMPTY_ERROR, ...rest };
}

function hasButton(prompt: TrainerPrompt, actionIndex: number): boolean {
  return prompt.buttons.some((button) => button.index === actionIndex);
}

function chooseAction(state: SpotState, event: Extract<SpotEvent, { type: "choose_action" }>): SpotState {
  if (state.kind !== "await_action" && state.kind !== "await_confidence") return state;
  if (!hasButton(state.prompt, event.actionIndex)) return state;
  const { context, prompt, shownAt } = state;
  return { kind: "await_confidence", context, prompt, shownAt, actionIndex: event.actionIndex, committedAt: event.at };
}

function tapConfidence(state: SpotState, event: Extract<SpotEvent, { type: "confidence" }>): SpotState {
  if (state.kind !== "await_confidence") return state;
  const decision: PendingDecision = {
    actionIndex: state.actionIndex,
    confidence: event.confidence,
    responseMs: Math.max(0, Math.round(state.committedAt - state.shownAt)),
    idempotencyKey: event.key,
    stateVersion: state.prompt.state_version,
  };
  return { kind: "submitting", context: state.context, prompt: state.prompt, decision };
}

function promptLoaded(state: SpotState, event: Extract<SpotEvent, { type: "prompt_loaded" }>): SpotState {
  if (state.kind !== "loading_prompt" && state.kind !== "stale") return state;
  const notice = state.kind === "stale" ? "stale" : null;
  return { kind: "await_action", context: state.context, prompt: event.prompt, shownAt: event.at, notice };
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

const ENDABLE: ReadonlySet<SpotStateKind> = new Set(["loading_prompt", "stale", "await_action", "await_confidence", "feedback", "error"]);

function end(state: SpotState, key: string): SpotState {
  if (!ENDABLE.has(state.kind) || !("context" in state) || state.context === null) return state;
  return { kind: "ending", context: state.context, key };
}

/** Back to the start panel after the recap, or after an error nothing can retry (no coverage, an ended session). */
function reset(state: SpotState): SpotState {
  if (state.kind === "ended" || (state.kind === "error" && (state.context === null || state.retry === null))) return INITIAL_SPOT_STATE;
  return state;
}

export function transition(state: SpotState, event: SpotEvent): SpotState {
  switch (event.type) {
    case "start":
      return state.kind === "idle" ? { kind: "starting", key: event.key, rng: event.rng } : state;
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
  }
}
