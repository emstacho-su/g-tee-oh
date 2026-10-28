/**
 * The HTTP (Hypertext Transfer Protocol) status codes the web branches on, in one place (R3.13;
 * S25 added the study and trainer codes), so a status means the same thing in the client, the
 * hooks, the study screen and the trainer.
 */
import { isApiProblem } from "./problem.js";

export const HTTP_STATUS = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unprocessable: 422,
  tooManyRequests: 429,
  badGateway: 502,
  unavailable: 503,
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
