/**
 * Safe failure texts for the study screen (S25, R3.12, A5 section 3). A failed read becomes a
 * short fixed message and whether a retry can help; the problem's detail text is never shown, as
 * the S24 login set the precedent. The cases the contract names: 404 at a node (no preflop
 * solution for the pair, or a token past the end of the tree), 404 hand-not-in-range at insights,
 * 502 (solver-query failed) and 503 (a transient stall: retry, no state change). Anything else,
 * a network failure included, is a generic retryable failure.
 */
import { isApiProblem } from "../api/index.js";

export interface StudyFailure {
  readonly message: string;
  readonly retryable: boolean;
}

const STATUS_NOT_FOUND = 404;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;
export const HAND_NOT_IN_RANGE_SLUG = "hand-not-in-range";

const UPSTREAM_FAILURES: Readonly<Record<number, StudyFailure>> = {
  [STATUS_BAD_GATEWAY]: { message: "The solver service failed to answer.", retryable: true },
  [STATUS_UNAVAILABLE]: { message: "The solver service is busy right now.", retryable: true },
};

function statusOf(error: unknown): number | undefined {
  return isApiProblem(error) ? error.status : undefined;
}

export function nodeFailure(error: unknown): StudyFailure {
  const status = statusOf(error);
  if (status === STATUS_NOT_FOUND) {
    return { message: "The library holds no solution for this pair and line.", retryable: false };
  }
  return (status === undefined ? undefined : UPSTREAM_FAILURES[status]) ?? {
    message: "This node could not be loaded.",
    retryable: true,
  };
}

export function insightsFailure(error: unknown, hand: string): StudyFailure {
  if (isApiProblem(error) && error.status === STATUS_NOT_FOUND) {
    const message =
      error.slug === HAND_NOT_IN_RANGE_SLUG
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

/** Every catalog failure reads the same: the catalog is small and one retry refetches it all. */
export function catalogFailure(): StudyFailure {
  return { message: "The game catalog could not be loaded.", retryable: true };
}
