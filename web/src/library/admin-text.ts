/**
 * Fixed failure messages for the admin writes (S28, R3.5, O-242): pause, resume and the settings
 * save. The problem's detail text is never shown (the S24 login precedent).
 */
import { HTTP_STATUS, isApiProblem } from "../api/index.js";

const ADMIN_FAILURE_TEXT: Readonly<Record<number, string>> = {
  [HTTP_STATUS.badRequest]: "The api refused these values. Check them and try again.",
  [HTTP_STATUS.unprocessable]: "The api refused these values. Check them and try again.",
  [HTTP_STATUS.forbidden]: "Only an admin can change the builder.",
  [HTTP_STATUS.conflict]: "Another change is still being saved. Try again in a moment.",
  [HTTP_STATUS.tooManyRequests]: "Too many requests. Try again in a minute.",
};

export function adminFailureText(error: unknown): string {
  const status = isApiProblem(error) ? error.status : undefined;
  return (status === undefined ? undefined : ADMIN_FAILURE_TEXT[status]) ?? "The change could not be saved. Try again.";
}
