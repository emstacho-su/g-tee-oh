/**
 * The problems a session derivation answers (R3.6, A5 section 3): a solver-query answer the
 * derivation cannot follow (502 upstream), solver-query past the request's deadline (503
 * unavailable, transient: nothing was written, so the same request may simply be sent again), an
 * ended session (409 session-ended), and a drill whose spot filter the library cannot satisfy (422
 * no-coverage with a named reason, O-249). The reason names which part of the filter failed, so the
 * player knows what to change in the drill.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";

/** Why a drill's filter cannot be dealt, as the 422 detail names it. */
export const FILTER_UNMET_REASONS = {
  noCoverage: "the library covers none of this drill's spots",
  noHeroNode:
    "no node of the covered spots has a hero seat to act in the drill's preflop action with a hand its hands filter keeps",
  noHandInRange: "no dealt hand was in the hero's range at the drill's spots within the deal bound",
} as const;

export type FilterUnmetReason = keyof typeof FILTER_UNMET_REASONS;

/**
 * A route that serves one session mode refuses the others with 409 wrong-session-mode (S27, O-302):
 * the drill routes (next, decisions) refuse prediction and range_paint sessions, so a practice
 * session never reaches the trainer machine or grading, and the practice routes refuse the rest.
 */
export function wrongSessionModeProblem(actual: string, expected: string): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.wrongSessionMode, {
    detail: `This is a ${actual} session; this route serves ${expected} sessions.`,
  });
}

export function requireSessionMode(session: { mode: string }, expected: string): void {
  if (session.mode !== expected) {
    throw wrongSessionModeProblem(session.mode, expected);
  }
}

export function upstreamInconsistent(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, { detail });
}

export function deadlineProblem(deadlineMs: number): ProblemError {
  return new ProblemError(HTTP_STATUS.unavailable, PROBLEM_SLUGS.unavailable, {
    detail: `solver-query did not answer within this request's ${deadlineMs} ms; nothing was written, so try again.`,
  });
}

export function sessionEndedProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.sessionEnded, { detail: "This session has ended." });
}

export function filterUnmetProblem(reason: FilterUnmetReason, extra = ""): ProblemError {
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noCoverage, {
    detail: `This drill cannot be dealt: ${FILTER_UNMET_REASONS[reason]}.${extra === "" ? "" : ` ${extra}`}`,
  });
}
