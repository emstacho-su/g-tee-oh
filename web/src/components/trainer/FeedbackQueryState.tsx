/**
 * The failure state shared by the feedback panel's range view, threshold card, drift card, the
 * Explanation section and the Ask status and answer (S25, R3.13, O-281); their loading state is the
 * shared LoadingNote (components/ui).
 *
 * Mechanism: a failed read becomes an explicit alert naming what failed and why, in words: the
 * cause by the problem's HTTP status (the library has nothing for this spot on a 404, a refused
 * request on another 4xx, a busy solver on a 429 or 503, no answer on any other 5xx), or the
 * network when the request never reached the api. The status number itself is never shown (S48
 * critic G4: "status 404" is written for a developer), and neither is the server's detail text
 * (S24 precedent: the login shows a generic error). A Retry button refetches, which is what a 502
 * or a 503 (a transient solver-query stall) needs.
 */
import { HTTP_STATUS, isApiProblem } from "../../api/index.js";
import { Button } from "../ui/index.js";

/** The cause of a failed read in words, by what the api answered. */
export const FAILURE_REASONS = {
  notFound: "the library has nothing for this spot",
  refused: "the request was refused",
  busy: "the solver data is busy, so try again in a moment",
  noAnswer: "the solver data did not answer",
  network: "the network did not answer",
} as const;

const FIRST_CLIENT_STATUS = 400;
const FIRST_SERVER_STATUS = 500;

/** The words for an api problem's status: a 404, another 4xx, a 429 or 503, or another 5xx. */
export function statusReason(status: number): string {
  if (status === HTTP_STATUS.notFound) return FAILURE_REASONS.notFound;
  if (status === HTTP_STATUS.tooManyRequests || status === HTTP_STATUS.unavailable) return FAILURE_REASONS.busy;
  if (status >= FIRST_CLIENT_STATUS && status < FIRST_SERVER_STATUS) return FAILURE_REASONS.refused;
  return FAILURE_REASONS.noAnswer;
}

/** The cause in words: by status for an api problem, the network for anything that never got an answer. */
export function failureReason(error: unknown): string {
  return isApiProblem(error) ? statusReason(error.status) : FAILURE_REASONS.network;
}

/** "The range at this decision could not load: the library has nothing for this spot." */
export function failureSentence(subject: string, error: unknown): string {
  return `${subject} could not load: ${failureReason(error)}.`;
}

export interface QueryFailureProps {
  /** What could not load, as a sentence subject: "The threshold card". */
  subject: string;
  error: unknown;
  retryLabel: string;
  onRetry: () => void;
}

export function QueryFailure({ subject, error, retryLabel, onRetry }: QueryFailureProps) {
  return (
    <div className="flex items-center gap-2">
      <p role="alert" className="text-sm text-danger">
        {failureSentence(subject, error)}
      </p>
      <Button size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
