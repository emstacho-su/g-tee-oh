/**
 * Explanation and insight-card schemas (R3.18, R3.19, R3.20, 05 sections 9 and 10, A6 section 5,
 * ADR 0016), settled by S27 (O-303 to O-309).
 *
 * - More info: deterministic template sections over the attempt row, its node and insights (every
 *   number in the text is in that data, R3.19).
 * - Ask status and Ask: the feature flag (off until a model key is configured, O-305), the monthly
 *   cap in cents (O-5, O-306) and the answer with its validator outcome (O-308). The key never
 *   appears in any response (A9 section 3).
 * - Drift: the user's action-kind shares against the solver's per node family, shown only from 30
 *   decisions and never graded (O-304, 05 section 9).
 */
import { z } from "zod";

import { actionKindSchema } from "./study.js";
import { uuidSchema } from "./common.js";

export const attemptParamsSchema = z.object({ attempt_id: uuidSchema });

export const moreInfoTemplateSchema = z.enum(["facts", "range_advantage", "hand_role", "position", "blockers"]);

export const moreInfoSchema = z
  .object({
    attempt_id: uuidSchema,
    sections: z.array(
      z.object({
        template: moreInfoTemplateSchema,
        title: z.string(),
        text: z.string().describe("Every number in it exists in the node or insights data (R3.19, ADR 0016)"),
      }),
    ),
  })
  .meta({ id: "MoreInfo" });

export const ASK_QUESTION_MAX_CHARS = 500;

export const askBodySchema = z.strictObject({
  question: z.string().trim().min(1).max(ASK_QUESTION_MAX_CHARS),
});

export const askResultSchema = z
  .object({
    attempt_id: uuidSchema,
    text: z.string().describe("Plain text; never rendered as HTML"),
    validated: z.boolean().describe("False when the validator still found an unsupported number or name after one regeneration"),
    warning: z.string().nullable(),
    cached: z.boolean().describe("True when served from the cache, which spends nothing"),
    cost_cents: z.number().int().min(0),
  })
  .meta({ id: "AskResult" });

export const askStatusReasonSchema = z.enum(["ok", "flag_off", "cap_reached"]);

export const askStatusSchema = z
  .object({
    enabled: z.boolean().describe("The feature flag: off until a model key is configured (O-305)"),
    available: z.boolean().describe("Enabled and under the monthly cap; the Ask button is disabled otherwise"),
    reason: askStatusReasonSchema,
    cap_cents: z.number().int().min(0),
    spent_cents: z.number().int().min(0),
    month: z.iso.date().describe("The first day of the UTC month the spend counts toward"),
  })
  .meta({ id: "AskStatus" });

export const SPOT_CLASS_KEY_MAX_CHARS = 128;

export const driftQuerySchema = z.object({
  spot_class_key: z.string().min(1).max(SPOT_CLASS_KEY_MAX_CHARS),
});

export const driftSchema = z
  .object({
    spot_class_key: z.string(),
    decisions: z.number().int().min(0),
    min_decisions: z.number().int().min(1),
    shown: z.boolean().describe("False below min_decisions; every number below is then null or empty"),
    distance: z.number().nullable().describe("Total variation distance between the user's and the solver's kind shares"),
    ci_low: z.number().nullable(),
    ci_high: z.number().nullable(),
    confidence: z.number(),
    by_kind: z.array(z.object({ kind: actionKindSchema, user_share: z.number(), solver_share: z.number() })),
  })
  .meta({ id: "RangeDrift" });
