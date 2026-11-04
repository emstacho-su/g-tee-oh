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
 * (S24 precedent: the login shows a generic error). The next action fits the cause: a Retry button
 * refetches, which is what a 502 or a 503 (a transient solver-query stall) needs; on a 404 a
 * retry cannot help, so a caller that knows the spot (the feedback's config_id and pair) gets
 * "Request this spot" instead, the library's own gap request (use-gap-request.ts, ADR 0018: the
 * request costs nothing and answers in words, no solve starts here), and the answer shows under
 * it (round 5 critic on ask-disabled-cap). The row wraps, and the button keeps its width, so a
 * long cause at phone width never squeezes the label out of the button.
 */
import { HTTP_STATUS, isApiProblem } from "../../api/index.js";
import { useAppApi } from "../../auth/index.js";
import { requestFailureText, requestResultText } from "../../library/request-text.js";
import { useGapRequest } from "../../library/use-gap-request.js";
import { Button } from "../ui/index.js";

/** The cause of a failed read in words, by what the api answered. */
export const FAILURE_REASONS = {
  notFound: "the library has nothing for this spot",
  refused: "the request was refused",
  busy: "the solver data is busy, so try again in a moment",
  noAnswer: "the solver data did not answer",
  network: "the network did not answer",
} as const;

export const SPOT_REQUEST_TEXT = {
  request: "Request this spot",
  requesting: "Requesting this spot",
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

/** True when the library answered that it holds nothing for the read: a retry cannot help, a request can. */
export function isLibraryGap(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.notFound;
}

/** The spot a feedback names (config_id and pair), the key of a gap request. */
export interface FeedbackSpot {
  readonly configId: string;
  readonly pair: string;
}

export interface QueryFailureProps {
  /** What could not load, as a sentence subject: "The threshold card". */
  subject: string;
  error: unknown;
  retryLabel: string;
  onRetry: () => void;
  /** The spot the read was about, when the caller knows it: a 404 then offers a gap request instead of Retry. */
  spot?: FeedbackSpot;
}

const ROW_CLASSES = "flex flex-wrap items-center gap-2";
const BUTTON_CLASSES = "shrink-0";

/** "Request this spot": the library's gap request for the feedback's spot, with its answer in words. */
function SpotRequestAction({ spot }: { spot: FeedbackSpot }) {
  const api = useAppApi();
  const request = useGapRequest(api, spot.configId, spot.pair);
  return (
    <>
      <Button size="sm" className={BUTTON_CLASSES} disabled={request.pending} onClick={() => request.send({})}>
        {request.pending ? SPOT_REQUEST_TEXT.requesting : SPOT_REQUEST_TEXT.request}
      </Button>
      {request.result === undefined ? null : (
        <p role="status" data-testid="spot-request-result" className="basis-full text-sm text-muted">
          {requestResultText(request.result)}
        </p>
      )}
      {request.error === null || request.error === undefined ? null : (
        <p role="alert" data-testid="spot-request-failure" className="basis-full text-sm text-danger">
          {requestFailureText(request.error)}
        </p>
      )}
    </>
  );
}

export function QueryFailure({ subject, error, retryLabel, onRetry, spot }: QueryFailureProps) {
  return (
    <div className={ROW_CLASSES}>
      <p role="alert" className="text-sm text-danger">
        {failureSentence(subject, error)}
      </p>
      {spot !== undefined && isLibraryGap(error) ? (
        <SpotRequestAction spot={spot} />
      ) : (
        <Button size="sm" className={BUTTON_CLASSES} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
