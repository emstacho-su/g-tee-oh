/**
 * The 501 handler for routes the contract declares before their session builds them (O-38). The
 * route keeps its full request schema, so a client generated today already calls it with the
 * right shape, and the problem detail names the owning session.
 */
import type { FastifyRequest } from "fastify";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "./problem.js";

export const NOT_IMPLEMENTED_STATUS = HTTP_STATUS.notImplemented;

export function notImplemented(request: FastifyRequest): never {
  const owner = request.routeOptions.config.owner ?? "a later session";
  throw new ProblemError(NOT_IMPLEMENTED_STATUS, PROBLEM_SLUGS.notImplemented, {
    detail: `This endpoint is declared in the v1 contract and is built by ${owner}.`,
  });
}

/** The description suffix for a route that answers 501 until its owner builds it. */
export function plannedDescription(owner: string, summary: string): string {
  return `${summary}\n\nAnswers 501 until ${owner} builds it (O-38).`;
}
