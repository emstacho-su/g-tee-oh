/**
 * Problems the study screen and the trainer recognise by kind (S25, R3.12, R3.13): one test per
 * kind, shared, so the two screens can never disagree on what a problem means.
 */
import { HTTP_STATUS } from "./http-status.js";
import { isApiProblem } from "./problem.js";

/** The slug of the api's 404 when a hand is not in the node's range (S23 insights). */
export const HAND_NOT_IN_RANGE_SLUG = "hand-not-in-range";

/** True for the api's 404 hand-not-in-range problem. */
export function isHandNotInRange(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.notFound && error.slug === HAND_NOT_IN_RANGE_SLUG;
}
