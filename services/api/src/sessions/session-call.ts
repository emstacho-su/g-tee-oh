/**
 * What every session operation receives (R3.6): the app (database, solver-query, learning hooks),
 * the request (upstream headers, the Idempotency-Key claim) and the signed-in user; and the parsed
 * POST /sessions body the mode modules take (sessions/modes/*).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import type { sessionCreateBodySchema } from "../schemas/training.js";

export type SessionCreateBody = z.infer<typeof sessionCreateBodySchema>;

export interface SessionCall {
  app: FastifyInstance;
  request: FastifyRequest;
  userId: string;
}
