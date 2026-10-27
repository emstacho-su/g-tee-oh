/**
 * The HTTP (Hypertext Transfer Protocol) status codes the web's session handling branches on, in
 * one place (R3.13), so a 401 means the same thing in the client, the hooks and the pages.
 */
import { isApiProblem } from "./problem.js";

export const HTTP_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  tooManyRequests: 429,
} as const;

/**
 * A short description of a failed request that is safe to log: the status and problem slug for
 * an api problem, else the error's name. Never a body, a detail text, a token or a URL, so
 * nothing sensitive reaches the console.
 */
export function describeFailureForLog(error: unknown): string {
  if (isApiProblem(error)) return `status ${error.status}, problem ${error.slug}`;
  if (error instanceof Error) return error.name;
  return "unknown failure";
}
