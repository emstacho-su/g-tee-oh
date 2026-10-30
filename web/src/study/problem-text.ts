/**
 * Safe failure texts for the study screen (S25, R3.12, A5 section 3). A failed read becomes a
 * short fixed message and whether a retry can help; the problem's detail text is never shown, as
 * the S24 login set the precedent. The cases the contract names: 404 at a node (no preflop
 * solution for the pair, or a token past the end of the tree), 404 hand-not-in-range at insights,
 * 502 (solver-query failed) and 503 (a transient stall: retry, no state change). Anything else,
 * a network failure included, is a generic retryable failure.
 */
import { HTTP_STATUS, isApiProblem, isHandNotInRange } from "../api/index.js";

export interface StudyFailure {
  readonly message: string;
  readonly retryable: boolean;
}

const UPSTREAM_FAILURES: Readonly<Record<number, StudyFailure>> = {
  [HTTP_STATUS.badGateway]: { message: "The solver service failed to answer.", retryable: true },
  [HTTP_STATUS.unavailable]: { message: "The solver service is busy right now.", retryable: true },
};

function statusOf(error: unknown): number | undefined {
  return isApiProblem(error) ? error.status : undefined;
}

export function nodeFailure(error: unknown): StudyFailure {
  const status = statusOf(error);
  if (status === HTTP_STATUS.notFound) {
    return { message: "The library holds no solution for this pair and line.", retryable: false };
  }
  return (status === undefined ? undefined : UPSTREAM_FAILURES[status]) ?? {
    message: "This node could not be loaded.",
    retryable: true,
  };
}

export function insightsFailure(error: unknown, hand: string): StudyFailure {
  if (isApiProblem(error) && error.status === HTTP_STATUS.notFound) {
    const message = isHandNotInRange(error)
      ? `${hand} is not in the range at this node, so it has no threshold card.`
      : `The library holds no insights for ${hand} at this node.`;
    return { message, retryable: false };
  }
  const status = statusOf(error);
  return (status === undefined ? undefined : UPSTREAM_FAILURES[status]) ?? {
    message: `The insights for ${hand} could not be loaded.`,
    retryable: true,
  };
}

const ADVANTAGE_LEAD = "The range advantage could not be loaded";

/**
 * A failed read of the range advantage (S45 code review, O-461). The read uses a stand-in hand the
 * user never picked, so the message names no hand: a 404 says the library holds none at this node,
 * a 502 or 503 adds the upstream cause, anything else is a generic retryable failure.
 */
export function advantageFailure(error: unknown): StudyFailure {
  const status = statusOf(error);
  if (status === HTTP_STATUS.notFound) return { message: "The library holds no range advantage at this node.", retryable: false };
  const upstream = status === undefined ? undefined : UPSTREAM_FAILURES[status];
  if (upstream === undefined) return { message: `${ADVANTAGE_LEAD}.`, retryable: true };
  return { message: `${ADVANTAGE_LEAD}: ${upstream.message.charAt(0).toLowerCase()}${upstream.message.slice(1)}`, retryable: upstream.retryable };
}

/** Every catalog failure reads the same: the catalog is small and one retry refetches it all. */
export function catalogFailure(): StudyFailure {
  return { message: "The game catalog could not be loaded.", retryable: true };
}
