/**
 * The problems a session derivation answers (R3.6, A5 section 3): a solver-query answer the
 * derivation cannot follow (502 upstream), an ended session (409 session-ended), and a drill whose
 * spot filter the library cannot satisfy (422 no-coverage with a named reason, O-249). The reason
 * names which part of the filter failed, so the player knows what to change in the drill.
 */
import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";

/** Why a drill's filter cannot be dealt, as the 422 detail names it. */
export const FILTER_UNMET_REASONS = {
  noCoverage: "the library covers none of this drill's spots",
  noHeroNode:
    "no node of the covered spots has a hero seat to act in the drill's preflop action with a hand its hands filter keeps",
  handsNotDealt: "no dealt hand passed the drill's hands filter within the deal bound",
} as const;

export type FilterUnmetReason = keyof typeof FILTER_UNMET_REASONS;

export function upstreamInconsistent(detail: string): ProblemError {
  return new ProblemError(HTTP_STATUS.badGateway, PROBLEM_SLUGS.upstream, { detail });
}

export function sessionEndedProblem(): ProblemError {
  return new ProblemError(HTTP_STATUS.conflict, PROBLEM_SLUGS.sessionEnded, { detail: "This session has ended." });
}

export function filterUnmetProblem(reason: FilterUnmetReason, extra = ""): ProblemError {
  return new ProblemError(HTTP_STATUS.unprocessable, PROBLEM_SLUGS.noCoverage, {
    detail: `This drill cannot be dealt: ${FILTER_UNMET_REASONS[reason]}.${extra === "" ? "" : ` ${extra}`}`,
  });
}
