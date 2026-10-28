/**
 * Progress, explanation, events and admin schemas (A5 section 3), declared by S21 for the
 * contract-first commit (O-38). Owners: progress S31 (R4.x), explanations S27 (R3.19, R3.20),
 * events and admin S23 (R3.4, R3.5). Shapes are drafts the owners may change with a visible
 * contract diff; S31 replaced the progress drafts (R4.12).
 */
import { z } from "zod";

import { builderSettingValueSchemas } from "../admin/settings-keys.js";
import { pageQuerySchema, pageSchema } from "../http/pagination.js";
import { timestampSchema, uuidSchema } from "./common.js";
import { tierSchema, trackKeySchema } from "./training.js";

// S31 (R4.12, O-271 to O-279): the six progress shapes replace S21's drafts. Track keys come from
// learning/tracks.ts; every list that can grow is a cursor page (pagination.ts, the S21 collection rule).

/** The most weeks /progress/leaks looks back (O-275). */
export const MAX_LEAK_WEEKS = 52;
/** The weeks /progress/leaks shows by default (O-275). */
export const DEFAULT_LEAK_WEEKS = 8;
/** /progress/leaks lists the top this many classes by current leak cost (O-275). */
export const TOP_LEAKS = 10;
/** Rated decisions that make a streak day count (O-278). */
export const STREAK_DAY_MINIMUM = 5;


export const ratingSchema = z
  .object({
    overall: z
      .object({
        mu: z.number().describe("Weighted mean of the track ratings (O-271)"),
        rd: z.number().describe("Weighted rating deviation, the band around mu"),
        conservative: z.number().describe("The figure the tier ranks on"),
        tier: tierSchema,
        band_tier: tierSchema.describe("The tier the conservative figure alone would give"),
        blocked_by: z.array(trackKeySchema).describe("Tracks whose deviation holds the tier below band_tier"),
      })
      .nullable()
      .describe("Null before any rated session"),
    updated_at: timestampSchema.nullable(),
  })
  .meta({ id: "ProgressRating" });

export const trackProgressSchema = z
  .object({
    track_key: trackKeySchema,
    name: z.string(),
    family: z.enum(["equilibrium", "exploit"]),
    format: z.enum(["cash", "mtt"]),
    weight: z.number().min(0).max(1).describe("Effective weight, normalized over tracks with a covered class (O-271)"),
    mu: z.number(),
    rd: z.number(),
    conservative: z.number(),
    rated_decisions: z.number().int().min(0),
    last_rated_at: timestampSchema.nullable(),
  })
  .meta({ id: "TrackProgress" });

export const tracksQuerySchema = pageQuerySchema;
export const tracksSchema = pageSchema(trackProgressSchema).meta({ id: "ProgressTracks" });

export const leaksQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(MAX_LEAK_WEEKS).default(DEFAULT_LEAK_WEEKS),
});

export const leaksSchema = z
  .object({
    weeks: z.array(z.iso.date()).describe("Mondays, oldest first; the last is the current partial week"),
    items: z
      .array(
        z.object({
          spot_class_key: z.string(),
          family: z.string(),
          track_key: trackKeySchema.nullable(),
          leak_cost_bb_per_1k: z.number(),
          series: z.array(
            z.object({
              week: z.iso.date(),
              leak_cost_bb_per_1k: z.number().nullable(),
              partial: z.boolean().describe("True for the current week, computed live"),
            }),
          ),
        }),
      )
      .max(TOP_LEAKS)
      .describe(`The top ${TOP_LEAKS} classes by current leak cost`),
  })
  .meta({ id: "ProgressLeaks" });

export const heatmapSchema = z
  .object({
    rows: z.array(z.object({ family: z.string(), pair: z.string() })),
    columns: z.array(z.object({ depth_band: z.string(), format: z.string() })),
    cells: z.array(
      z.object({
        spot_class_key: z.string(),
        row: z.number().int().min(0).describe("Index into rows"),
        column: z.number().int().min(0).describe("Index into columns"),
        p_known: z.number().nullable().describe("Null when never practiced"),
        mastered: z.boolean(),
        retrievability: z.number().nullable(),
        n: z.number().int().min(0),
      }),
    ),
  })
  .meta({ id: "ProgressHeatmap" });

export const holdoutRoundSchema = z
  .object({
    round_month: z.iso.date().describe("The first day of the round's month"),
    opened_at: timestampSchema,
    closed_at: timestampSchema.nullable(),
    tracks: z.array(
      z.object({
        track_key: trackKeySchema,
        answered: z.number().int().min(0),
        total: z.number().int().min(0),
        mean_score: z.number().nullable(),
        mu: z.number().nullable().describe("The track rating at the round's close"),
        goodhart_flag: z.boolean().describe("Rating rose while holdout scores did not (O-277)"),
      }),
    ),
  })
  .meta({ id: "HoldoutRound" });

export const holdoutQuerySchema = pageQuerySchema;
export const holdoutSchema = pageSchema(holdoutRoundSchema)
  .extend({
    open: z
      .object({ round_month: z.iso.date(), answered: z.number().int().min(0), total: z.number().int().min(0) })
      .nullable()
      .describe("The open round's progress; null when no round is open"),
  })
  .meta({ id: "ProgressHoldout" });

export const streakSchema = z
  .object({
    current_days: z.number().int().min(0),
    longest_days: z.number().int().min(0),
    today_rated: z.number().int().min(0),
    day_minimum: z.literal(STREAK_DAY_MINIMUM),
    freezes_left_this_week: z.number().int().min(0),
    repairable: z
      .object({
        day: z.iso.date(),
        deadline: timestampSchema,
        progress: z.number().int().min(0),
        needed: z.number().int().min(0),
      })
      .nullable()
      .describe("A missed day that can still be repaired (O-278)"),
    unlocks: z.array(z.object({ cosmetic_key: z.string(), unlocked_at: timestampSchema })),
    next_milestone: z.object({ days: z.number().int().min(1), cosmetic_key: z.string() }).nullable(),
  })
  .meta({ id: "ProgressStreak" });

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
