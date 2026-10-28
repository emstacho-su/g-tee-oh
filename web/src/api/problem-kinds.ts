/**
 * Problems the study screen and the trainer recognise by kind (S25, R3.12, R3.13): one test per
 * kind, shared, so the two screens can never disagree on what a problem means. S27 adds the two
 * Ask problems, ask-disabled and ask-cap-reached (O-307).
 */
import { HTTP_STATUS } from "./http-status.js";
import { isApiProblem } from "./problem.js";

/** The slug of the api's 404 when a hand is not in the node's range (S23 insights). */
export const HAND_NOT_IN_RANGE_SLUG = "hand-not-in-range";

/** True for the api's 404 hand-not-in-range problem. */
export function isHandNotInRange(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.notFound && error.slug === HAND_NOT_IN_RANGE_SLUG;
}

/** The slug of the api's 503 while the Ask flag is off (S27, O-305, O-307). */
const ASK_DISABLED_SLUG = "ask-disabled";
/** The slug of the api's 429 once this month's Ask spend reached the cap (S27, O-306, O-307). */
const ASK_CAP_REACHED_SLUG = "ask-cap-reached";

/** True for the api's 503 ask-disabled problem (S27, R3.20). */
export function isAskDisabled(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.unavailable && error.slug === ASK_DISABLED_SLUG;
}

/** True for the api's 429 ask-cap-reached problem (S27, R3.20). */
export function isAskCapReached(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.tooManyRequests && error.slug === ASK_CAP_REACHED_SLUG;
}
