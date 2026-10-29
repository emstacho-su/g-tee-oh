/**
 * Failure classification for the trainer in spot mode (S25, R3.13, A5 section 3, ADR 0018, O-232).
 * Pure.
 *
 * Mechanism: problemOf turns whatever a session request threw into a small SpotProblem: the api's
 * problem slug and status for an ApiProblem (409 stale-state, 409 session-ended, 409
 * idempotency-in-flight, 422 no-coverage, 502 and 503 as unavailable, 401 as signed out), a
 * TypeError or a TimeoutError or AbortError DOMException as a network failure (fetch rejects with
 * one of those when the request never completes), anything else as "other".
 *
 * isRetryable names the transient problems, the only ones a retry of the very same request may
 * cure: a network failure or timeout, 502 and 503, a 409 whose first copy is still in flight, and
 * a stale end (the api says to end again). A fixed answer (400, 403, 404, 422, another 409) is not
 * retried; the screen offers End or Start instead. problemMessage gives the screen a fixed, safe
 * sentence per kind, so the server's detail text is never shown to the user (S24 precedent).
 *
 * S26 (R3.14, O-312, PR #30 review MEDIUM 3): a 422 no-coverage carries how many of the drill's
 * spots were queued for the builder as the typed members pairs_total and pairs_queued, kept by
 * NoCoverageProblem (session-problem.ts). problemOf copies them into queued, so the screen can say
 * them in its own sentence. The detail text is never parsed and never shown.
 */
import { HTTP_STATUS } from "../api/http-status.js";
import { isApiProblem } from "../api/index.js";
import { NO_COVERAGE_SLUG, NoCoverageProblem, type QueuedCount } from "./session-problem.js";

export type { QueuedCount } from "./session-problem.js";

export type SpotProblemKind =
  | "no_coverage"
  | "stale"
  | "session_ended"
  | "in_flight"
  | "unavailable"
  | "network"
  | "signed_out"
  | "other";

export interface SpotProblem {
  readonly kind: SpotProblemKind;
  /** The HTTP status, or null when no response arrived. */
  readonly status: number | null;
  /** The 422 no-coverage's typed pairs_queued and pairs_total, when it carried valid ones. */
  readonly queued?: QueuedCount;
  /** The slug of an api problem of kind "other" (none of the trainer's kinds), so a screen can name it (S32 /train). */
  readonly slug?: string;
}

/** The api's problem slugs the trainer branches on (services/api/src/http/problem.ts). */
export const SESSION_PROBLEM_SLUG = {
  staleState: "stale-state",
  sessionEnded: "session-ended",
  idempotencyInFlight: "idempotency-in-flight",
  noCoverage: NO_COVERAGE_SLUG,
} as const;

/** The DOMException names fetch rejects with when a request times out or is aborted. */
const INTERRUPTED_REQUEST_NAMES: ReadonlySet<string> = new Set(["TimeoutError", "AbortError"]);

const CONFLICT_KINDS: Readonly<Record<string, SpotProblemKind>> = {
  [SESSION_PROBLEM_SLUG.staleState]: "stale",
  [SESSION_PROBLEM_SLUG.sessionEnded]: "session_ended",
  [SESSION_PROBLEM_SLUG.idempotencyInFlight]: "in_flight",
};

function kindOfApiProblem(status: number, slug: string): SpotProblemKind {
  if (status === HTTP_STATUS.unauthorized) return "signed_out";
  if (status === HTTP_STATUS.conflict) return CONFLICT_KINDS[slug] ?? "other";
  if (status === HTTP_STATUS.unprocessable && slug === SESSION_PROBLEM_SLUG.noCoverage) return "no_coverage";
  if (status === HTTP_STATUS.badGateway || status === HTTP_STATUS.unavailable) return "unavailable";
  return "other";
}

export function problemOf(error: unknown): SpotProblem {
  if (isApiProblem(error)) {
    const kind = kindOfApiProblem(error.status, error.slug);
    const queued = kind === "no_coverage" && error instanceof NoCoverageProblem ? error.counts : null;
    if (kind === "other") return { kind, status: error.status, slug: error.slug };
    return queued === null ? { kind, status: error.status } : { kind, status: error.status, queued };
  }
  if (error instanceof TypeError) return { kind: "network", status: null };
  if (error instanceof DOMException && INTERRUPTED_REQUEST_NAMES.has(error.name)) return { kind: "network", status: null };
  return { kind: "other", status: null };
}

const TRANSIENT_KINDS: ReadonlySet<SpotProblemKind> = new Set(["network", "unavailable", "in_flight", "stale"]);

/** Whether repeating the same request may succeed: a transient failure, not an answer. */
export function isRetryable(problem: SpotProblem): boolean {
  return TRANSIENT_KINDS.has(problem.kind);
}

const MESSAGES: Readonly<Record<Exclude<SpotProblemKind, "other">, string>> = {
  no_coverage:
    "This drill has no covered spot in the library yet. Its spots were queued for the library builder; try again once it has built them.",
  stale: "The session moved on, so this is its current hand.",
  session_ended: "This session has ended.",
  in_flight: "The same request is still being processed. Try again in a moment.",
  unavailable: "The solver service did not answer in time. Nothing was saved; try again.",
  network: "The request did not reach the server. Check the connection and try again.",
  signed_out: "You were signed out. Sign in again to keep training.",
};

/** A fixed sentence for the screen; for "other" only the status is added, never the detail. */
export function problemMessage(problem: SpotProblem): string {
  if (problem.kind !== "other") return MESSAGES[problem.kind];
  return problem.status === null ? "The request failed." : `The request failed (status ${problem.status}).`;
}
