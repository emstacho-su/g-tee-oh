/**
 * POST /sessions in automated mode (R4.10, O-270 to O-274): expand config_ids into covered
 * (configuration, pair) candidates, build the queue from the class catalog and the user's schedule
 * cards, leak stats and mastery, pick the first review block, and write the session with
 * state.learning of kind automated (sessions/state.ts). A client-supplied seed makes the session
 * unrated end to end (the PM seed condition).
 *
 * Scaffold: Lane A replaces this body. Until it lands the mode answers 501 naming S31, as in S23.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../../http/problem.js";
import type { SessionCall, SessionCreateBody } from "../session-call.js";
import type { Session } from "../session-view.js";

export function createAutomatedSession(_call: SessionCall, body: SessionCreateBody): Promise<Session> {
  return Promise.reject(
    new ProblemError(HTTP_STATUS.notImplemented, PROBLEM_SLUGS.notImplemented, {
      detail: `${body.mode} sessions are built by S31; S23 serves drill sessions (O-249).`,
    }),
  );
}
