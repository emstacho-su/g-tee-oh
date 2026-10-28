/**
 * Failure classification for the trainer in spot mode (S25, R3.13, A5 section 3, ADR 0018). Pure.
 *
 * Mechanism: problemOf turns whatever a session request threw into a small SpotProblem: the api's
 * problem slug and status for an ApiProblem (409 stale-state, 409 session-ended, 422 no-coverage,
 * 502 and 503 as unavailable, 401 as signed out), a TypeError as a network failure (fetch rejects
 * with one when the request never reaches a server), anything else as "other". The machine
 * (spot-machine.ts) branches on the kind; problemMessage gives the screen a fixed, safe sentence
 * per kind, so the server's detail text is never shown to the user (S24 precedent).
 */
import { HTTP_STATUS } from "../api/http-status.js";
import { isApiProblem } from "../api/index.js";

export type SpotProblemKind =
  | "no_coverage"
  | "stale"
  | "session_ended"
  | "unavailable"
  | "network"
  | "signed_out"
  | "other";

export interface SpotProblem {
  readonly kind: SpotProblemKind;
  /** The HTTP status, or null when no response arrived. */
  readonly status: number | null;
}

/** The api's problem slugs the trainer branches on (services/api/src/http/problem.ts). */
export const SESSION_PROBLEM_SLUG = {
  staleState: "stale-state",
  sessionEnded: "session-ended",
  noCoverage: "no-coverage",
} as const;

const STATUS = {
  conflict: 409,
  unprocessable: 422,
  badGateway: 502,
  unavailable: 503,
} as const;

function kindOfApiProblem(status: number, slug: string): SpotProblemKind {
  if (status === HTTP_STATUS.unauthorized) return "signed_out";
  if (status === STATUS.conflict && slug === SESSION_PROBLEM_SLUG.staleState) return "stale";
  if (status === STATUS.conflict && slug === SESSION_PROBLEM_SLUG.sessionEnded) return "session_ended";
  if (status === STATUS.unprocessable && slug === SESSION_PROBLEM_SLUG.noCoverage) return "no_coverage";
  if (status === STATUS.badGateway || status === STATUS.unavailable) return "unavailable";
  return "other";
}

export function problemOf(error: unknown): SpotProblem {
  if (isApiProblem(error)) return { kind: kindOfApiProblem(error.status, error.slug), status: error.status };
  if (error instanceof TypeError) return { kind: "network", status: null };
  return { kind: "other", status: null };
}

/** Whether repeating the same request may succeed: a transient failure, not an answer. */
export function isRetryable(problem: SpotProblem): boolean {
  return problem.kind !== "no_coverage" && problem.kind !== "session_ended" && problem.kind !== "signed_out";
}

const MESSAGES: Readonly<Record<Exclude<SpotProblemKind, "other">, string>> = {
  no_coverage:
    "This drill has no covered spot in the library yet. Its gaps were queued for the library builder; try again once it has built them.",
  stale: "The session moved on, so this is its current hand.",
  session_ended: "This session has ended.",
  unavailable: "The solver service did not answer in time. Nothing was saved; try again.",
  network: "The request did not reach the server. Check the connection and try again.",
  signed_out: "You were signed out. Sign in again to keep training.",
};

/** A fixed sentence for the screen; for "other" only the status is added, never the detail. */
export function problemMessage(problem: SpotProblem): string {
  if (problem.kind !== "other") return MESSAGES[problem.kind];
  return problem.status === null ? "The request failed." : `The request failed (status ${problem.status}).`;
}
