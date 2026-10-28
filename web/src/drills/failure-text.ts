/**
 * What the drill screens say when a request fails (S26, R3.14). The status and slug pick the
 * sentence; a validation problem's own detail is shown for an import (the api's detail names what
 * was wrong with the code, O-310, and holds no secret), and field errors are shown next to their
 * fields by the builder. A 401 never reaches these texts: the app sends the user to /login.
 */
import { HTTP_STATUS, isApiProblem } from "../api/index.js";

export const FAILURE_TEXT = {
  inUse: "A practice session still uses this drill, so it cannot be deleted.",
  notFound: "This drill no longer exists.",
  csrf: "The session check failed. Reload the page and try again.",
  rateLimited: "Too many requests. Wait a moment and try again.",
  invalid: "The api refused the drill. Fix the fields marked below.",
  importRefused: "The export code was refused.",
  generic: "The request failed. Try again.",
} as const;

/** The sentence for a failed read or write of a drill. */
export function drillFailureText(error: unknown): string {
  if (!isApiProblem(error)) return FAILURE_TEXT.generic;
  if (error.status === HTTP_STATUS.conflict) return FAILURE_TEXT.inUse;
  if (error.status === HTTP_STATUS.notFound) return FAILURE_TEXT.notFound;
  if (error.status === HTTP_STATUS.forbidden) return FAILURE_TEXT.csrf;
  if (error.status === HTTP_STATUS.tooManyRequests) return FAILURE_TEXT.rateLimited;
  if (error.status === HTTP_STATUS.badRequest) return FAILURE_TEXT.invalid;
  return FAILURE_TEXT.generic;
}

/** The sentence for a refused import: the api's detail for a 400, else drillFailureText. */
export function importFailureText(error: unknown): string {
  if (isApiProblem(error) && error.status === HTTP_STATUS.badRequest) return error.detail ?? FAILURE_TEXT.importRefused;
  return drillFailureText(error);
}
