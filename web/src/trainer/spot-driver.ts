/**
 * The driver that runs the spot machine's requests (S25, R3.13, R3.11, O-284, A7 section 4).
 *
 * Mechanism: send(event) computes the next state with the pure transition. An ignored event
 * (transition returned the same state) does nothing. An accepted one stores the state, reports it
 * through onChange and then runs the one request the entered state stands for: starting creates
 * the session, loading_prompt and stale read the prompt, submitting sends the decision, ending
 * ends the session, and feedback prefetches the next prompt (GET /next is pure, O-249) so Next is
 * instant. A request's answer comes back as an event (session_started, prompt_loaded,
 * decision_succeeded, ended, or failed with the classified problem).
 *
 * Every accepted transition bumps a generation counter and each request remembers the generation
 * it started in; an answer that arrives after the state moved on (the session was ended while a
 * prompt loaded, say) is dropped instead of being read as the answer to a later request. The
 * decision is sent only from submitting, which only the confidence tap enters (R3.11).
 */
import type { DecisionFeedback, TrainerPrompt } from "../contracts.js";
import type { PracticeSession, SessionRecap } from "./session-types.js";
import { INITIAL_SPOT_STATE, transition, type PendingDecision, type SpotEvent, type SpotState } from "./spot-machine.js";
import { problemOf, type SpotProblem } from "./spot-problem.js";

/** The input and output the driver needs; use-spot-session.ts binds it to the api and the cache. */
export interface SpotIo {
  createSession: (rng: boolean, key: string) => Promise<PracticeSession>;
  /** The prompt after this state version from the cache (or a read), or a fresh read when null. */
  loadPrompt: (sessionId: string, version: number | null) => Promise<TrainerPrompt>;
  prefetchPrompt: (sessionId: string, version: number) => void;
  submitDecision: (sessionId: string, decision: PendingDecision) => Promise<DecisionFeedback>;
  endSession: (sessionId: string, key: string) => Promise<SessionRecap>;
  /** Called with each prompt before it is shown (the trainer-table store). */
  onPrompt: (prompt: TrainerPrompt) => void;
  /** Called with each failure's problem before the machine sees it (a 401 signs out). */
  onProblem: (problem: SpotProblem) => void;
  now: () => number;
}

export interface SpotDriver {
  getState: () => SpotState;
  send: (event: SpotEvent) => void;
}

export function createSpotDriver(io: () => SpotIo, onChange: (state: SpotState) => void): SpotDriver {
  let state: SpotState = INITIAL_SPOT_STATE;
  let generation = 0;

  function settle<T>(token: number, request: Promise<T>, toEvent: (value: T) => SpotEvent): void {
    request.then(
      (value) => {
        if (token === generation) send(toEvent(value));
      },
      (error: unknown) => {
        if (token !== generation) return;
        const problem = problemOf(error);
        io().onProblem(problem);
        send({ type: "failed", problem });
      },
    );
  }

  function promptEvent(prompt: TrainerPrompt): SpotEvent {
    io().onPrompt(prompt);
    return { type: "prompt_loaded", prompt, at: io().now() };
  }

  function enter(entered: SpotState, token: number): void {
    switch (entered.kind) {
      case "starting":
        settle(token, io().createSession(entered.rng, entered.key), (session) => ({ type: "session_started", session }));
        return;
      case "loading_prompt":
        settle(token, io().loadPrompt(entered.context.session.session_id, entered.version), promptEvent);
        return;
      case "stale":
        settle(token, io().loadPrompt(entered.context.session.session_id, null), promptEvent);
        return;
      case "submitting":
        settle(token, io().submitDecision(entered.context.session.session_id, entered.decision), (feedback) => ({
          type: "decision_succeeded",
          feedback,
        }));
        return;
      case "feedback":
        io().prefetchPrompt(entered.context.session.session_id, entered.feedback.state_version);
        return;
      case "ending":
        settle(token, io().endSession(entered.context.session.session_id, entered.key), (recap) => ({ type: "ended", recap }));
        return;
      default:
        return;
    }
  }

  function send(event: SpotEvent): void {
    const next = transition(state, event);
    if (next === state) return;
    state = next;
    generation += 1;
    onChange(next);
    enter(next, generation);
  }

  return { getState: () => state, send };
}
