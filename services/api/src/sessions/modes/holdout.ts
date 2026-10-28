/**
 * POST /sessions in holdout mode (R4.13, O-276): refuse a body with a seed (400), open or find the
 * month's round, order its unanswered items and write the session with state.learning of kind
 * holdout (sessions/state.ts); no items is 422 no-holdout-items, none left 409 holdout-complete.
 *
 * Scaffold: Lane C replaces this body. Until it lands the mode answers 501 naming S31, as in S23.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import type { Session } from "../session-view.js";

export function createHoldoutSession(_call: SessionCall, body: SessionCreateBody): Promise<Session> {
  return Promise.reject(
    new ProblemError(HTTP_STATUS.notImplemented, PROBLEM_SLUGS.notImplemented, {
      detail: `${body.mode} sessions are built by S31; S23 serves drill sessions (O-249).`,
    }),
  );
}
