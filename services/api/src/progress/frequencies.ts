/**
 * GET /progress/frequencies (R4.12, S41, O-353): red stage stub; the build commit replaces it.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import { HTTP_STATUS, PROBLEM_SLUGS, ProblemError } from "../http/problem.js";
import type { FrequencyComparison } from "../schemas/frequencies.js";

export interface FrequencyCall {
  app: FastifyInstance;
  request: FastifyRequest;
  userId: string;
}

export async function frequencyProgress(_call: FrequencyCall): Promise<FrequencyComparison> {
  await Promise.resolve();
  throw new ProblemError(HTTP_STATUS.notImplemented, PROBLEM_SLUGS.notImplemented, { detail: "S41 builds this route." });
}
