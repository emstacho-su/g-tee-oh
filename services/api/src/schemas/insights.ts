/**
 * Progress, explanation, events and admin schemas (A5 section 3), declared by S21 for the
 * contract-first commit (O-38). Owners: progress S31 (R4.x), explanations S27 (R3.19, R3.20),
 * events and admin S23 (R3.4, R3.5). Shapes are drafts the owners may change with a visible
 * contract diff.
 */
import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const ratingSchema = z.object({
  overall: z.object({ mu: z.number(), rd: z.number(), tier: z.string() }),
  updated_at: timestampSchema.nullable(),
});

export const trackRatingSchema = z.object({
  track_id: uuidSchema,
  key: z.string(),
  family: z.enum(["equilibrium", "exploit"]),
  mu: z.number(),
  rd: z.number(),
});

export const tracksSchema = z.object({ items: z.array(trackRatingSchema) });

export const leaksQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(8),
});

export const leaksSchema = z.object({
  items: z.array(
    z.object({
      spot_class_key: z.string(),
      leak_cost_bb_per_1k: z.number(),
      trend: z.array(z.object({ week: z.iso.date(), leak_cost_bb_per_1k: z.number() })),
    }),
  ),
});

export const heatmapSchema = z.object({
  cells: z.array(z.object({ spot_class_key: z.string(), p_known: z.number(), n: z.number().int() })),
});

export const holdoutSchema = z.object({
  taken: z.number().int(),
  mean_score: z.number().nullable(),
  last_taken_at: timestampSchema.nullable(),
});

export const streakSchema = z.object({
  current_days: z.number().int(),
  longest_days: z.number().int(),
  freezes_available: z.number().int(),
});

export const attemptParamsSchema = z.object({ attempt_id: uuidSchema });

export const moreInfoSchema = z.object({
  template: z.string(),
  text: z.string().describe("Every number in it exists in the node or insights data (R3.19, ADR 0016)"),
});

export const askBodySchema = z.strictObject({
  question: z.string().trim().min(1).max(500),
});

export const askResultSchema = z.object({
  text: z.string(),
  validated: z.boolean(),
  cached: z.boolean(),
  cost_cents: z.number().int(),
});

export const builderStatusSchema = z
  .object({
    state: z.enum(["running", "paused", "throttled"]),
    reason: z.string().nullable(),
    queue: z.object({ queued: z.number().int(), running: z.number().int(), failed: z.number().int() }),
    throughput_per_hour: z.number(),
    storage: z.object({ library_bytes: z.number().int(), reference_bytes: z.number().int() }),
    settings: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "BuilderStatus" });

export const builderSettingsPatchSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.unknown())
  .refine((body) => Object.keys(body).length > 0, { message: "at least one setting is required" });

export const builderSettingsSchema = z.object({ settings: z.record(z.string(), z.unknown()) });

export const eventStreamSchema = z
  .string()
  .describe("text/event-stream with events coverage_added, builder_state and session_nudge (A4 section 4)");
