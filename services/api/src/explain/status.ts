/**
 * GET /explain/status (R3.20, O-305, O-306, O-307): the Ask button's state. Ask is enabled when
 * the flag is on and a model client exists (main.ts builds one only with a key); available when
 * it is enabled and this UTC month's spend is below the cap. The reason says why not: flag_off,
 * then cap_reached. Nothing about the key is in the answer (A9 section 3).
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";

import type { AppConfig } from "../config.js";
import { requireDatabase } from "../http/database.js";
import type { askStatusSchema } from "../schemas/explain.js";
import { monthOf, spentCents } from "./spend.js";

export type AskStatus = z.infer<typeof askStatusSchema>;

export function askEnabled(app: FastifyInstance, config: AppConfig): boolean {
  return config.explainAskEnabled && app.modelClient !== null;
}

export async function askStatus(app: FastifyInstance, config: AppConfig, now: Date): Promise<AskStatus> {
  const month = monthOf(now);
  const spent = await spentCents(requireDatabase(app), month);
  const enabled = askEnabled(app, config);
  const capReached = spent >= config.askMonthlyCapCents;
  const reason = !enabled ? "flag_off" : capReached ? "cap_reached" : "ok";
  return {
    enabled,
    available: reason === "ok",
    reason,
    cap_cents: config.askMonthlyCapCents,
    spent_cents: spent,
    month,
  };
}
