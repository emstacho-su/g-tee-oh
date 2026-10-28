/**
 * The DeriveSettings of a session (R3.6, R4.13, O-276): its stop rule and RNG mode, and the holdout
 * guard the learning hooks load for it, read only, once per request (sessions/holdout-guard.ts).
 * GET /next and POST decisions both derive with these, so a decision answers the prompt shown.
 */
import type { FastifyInstance } from "fastify";

import { requireDatabase } from "../http/database.js";
import type { DeriveSettings } from "./derive.js";
import type { SessionRow } from "./repository.js";

export async function deriveSettingsFor(app: FastifyInstance, userId: string, session: SessionRow): Promise<DeriveSettings> {
  const holdoutGuard = await app.learningHooks.loadHoldoutGuard({ database: requireDatabase(app), userId, session });
  return { stopRule: session.settings.stop_rule, rng: session.settings.rng, holdoutGuard };
}
