/**
 * Loading and failure states shared by the feedback panel's range view and threshold card (S25,
 * R3.13, O-281).
 *
 * Mechanism: a failed read becomes an explicit alert naming what failed and why in a short safe
 * form: the HTTP status of an ApiProblem, or "network error" when the request never reached the
 * api. Server detail text is never shown (S24 precedent: the login shows a generic error). A
 * Retry button refetches, which is what a 502 or a 503 (a transient solver-query stall) needs.
 */
import { isApiProblem } from "../../api/index.js";
import { Button } from "../ui/index.js";

/** "status 503" for an api problem, "network error" for anything that never got an answer. */
export function failureReason(error: unknown): string {
  return isApiProblem(error) ? `status ${error.status}` : "network error";
}

export interface QueryLoadingProps {
  text: string;
}

export function QueryLoading({ text }: QueryLoadingProps) {
  return (
    <p role="status" className="text-sm text-muted">
      {text}
    </p>
  );
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
        {`${subject} could not load (${failureReason(error)}).`}
      </p>
      <Button size="sm" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
