/**
 * Progress, explanation, events and admin schemas (A5 section 3), declared by S21 for the
 * contract-first commit (O-38). Owners: progress S31 (R4.x) (S27 moved explanations to explain.ts),
 * events and admin S23 (R3.4, R3.5). Shapes are drafts the owners may change with a visible
 * contract diff.
 */
import { z } from "zod";

import { builderSettingValueSchemas } from "../admin/settings-keys.js";
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

export const builderStatusSchema = z
  .object({
    state: z
      .enum(["running", "paused", "throttled", "idle", "unknown"])
      .describe(
        "paused while the paused setting is on, else the last state the builder announced since the api started, else unknown (O-243)",
      ),
    reason: z.string().nullable(),
    queue: z.object({
      queued: z.number().int(),
      running: z.number().int(),
      failed: z.number().int(),
      blocked_budget: z.number().int(),
    }),
    throughput_per_hour: z.number().describe("Builds done in the last 24 hours, divided by 24"),
    storage: z.object({ library_bytes: z.number().int(), reference_bytes: z.number().int() }),
    settings: z
      .record(z.string(), z.unknown())
      .describe("The stored overrides; an absent key means the builder's default (O-188)"),
  })
  .meta({ id: "BuilderStatus" });

/**
 * A settings change (R3.5, O-241): any of the builder's keys, each with its JSON type and cheap
 * bounds (admin/settings-keys.ts); an unknown key is a 400 problem. Semantic checks stay in the
 * builder, which reports them as settings errors (O-188).
 */
export const builderSettingsPatchSchema = z
  .strictObject(builderSettingValueSchemas)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "at least one setting is required" })
  .meta({ id: "BuilderSettingsPatch" });

export const builderSettingsSchema = z.object({
  settings: z
    .record(z.string(), z.unknown())
    .describe("The stored overrides; an absent key means the builder's default (O-188)"),
});

export const eventStreamSchema = z
  .string()
  .describe(
    "text/event-stream (O-243): a retry line, then coverage_added and builder_state to every signed-in user and build_progress to admins only, each as an event line and one JSON data line (A4 section 4), and a heartbeat comment every 15 seconds; no replay",
  );
