/**
 * The drill schema (R3.14, 05 section 4, A4 section 2). Field names are g-tee-oh's own, from the
 * right-hand column of 05 section 4 only (O-26, ADR 0017): spot_filter says which spots a drill
 * draws, trainer says how the trainer runs them, tags group drills in the library. The reference
 * tool's parameter names never appear here. Panel keys are named after the A7 components (O-235).
 *
 * Mechanism: spot_filter is stored in drill.spot_filter and trainer in drill.trainer_settings, both
 * jsonb, so the schema can grow without a migration; the strict objects reject unknown keys, so a
 * typo is a 400 and never a silently ignored field. S26 extends this schema (export code, import)
 * with a visible contract diff. The stake is named by its catalog label (1/3, 2/5, online), not
 * its row id, so a drill means the same thing in any database an export code is imported into.
 */
import { z } from "zod";

import { pageQuerySchema, pageSchema } from "../http/pagination.js";
import { checkSpotFilter } from "./spot-filter-rules.js";
import {
  flopSchema,
  gameFormatSchema,
  handClassSchema,
  lineSchema,
  positionSchema,
  streetSchema,
  tableSizeSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";

export const MAX_DRILL_NAME_LENGTH = 120;
export const MAX_TAGS = 20;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const MAX_DEPTHS = 8;
export const MAX_DEPTH_BB = 1000;
export const MAX_POSITIONS = 9;
export const MAX_HANDS = 169;
export const MAX_FLOPS = 200;
export const MAX_TABLES = 4;
export const MAX_STAKE_LABEL_LENGTH = 32;
export const TIMEBANK_SECONDS = [7, 15, 25] as const;

export const PREFLOP_ACTIONS = [
  "rfi",
  "vs_open",
  "srp",
  "three_bet",
  "vs_three_bet",
  "four_bet",
  "squeeze",
  "limp_iso",
  "straddle",
] as const;

/** Panel keys named after the A7 components (O-235). */
export const PANEL_KEYS = [
  "hero_range_matrix",
  "villain_range_matrix",
  "equity_distribution_chart",
  "range_advantage",
  "hand_class",
  "action_frequency_table",
  "made_hand_breakdown",
  "draw_breakdown",
  "threshold_card",
  "hero_strategy_matrix",
  "rng_roller",
  "streak_counter",
] as const;

const panelsShape = Object.fromEntries(PANEL_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
  (typeof PANEL_KEYS)[number],
  z.ZodOptional<z.ZodBoolean>
>;

export const drillGameConfigSchema = z.strictObject({
  format: gameFormatSchema,
  table_size: tableSizeSchema,
  depths_bb: z
    .array(z.number().int().min(1).max(MAX_DEPTH_BB))
    .min(1)
    .max(MAX_DEPTHS)
    .describe("Effective stack depths in big blinds"),
});

export const sizingSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("convention").describe("The configuration's sizing convention") }),
  z.strictObject({
    mode: z.literal("fixed"),
    open_bb: z.number().positive().max(MAX_DEPTH_BB).optional(),
    three_bet_bb: z.number().positive().max(MAX_DEPTH_BB).optional(),
  }),
]);

export const boardFilterSchema = z.strictObject({
  high_card: z.enum(["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]).optional(),
  paired: z.boolean().optional(),
  suits: z.enum(["monotone", "two_tone", "rainbow"]).optional(),
  connectivity: z.enum(["connected", "gapped", "disconnected"]).optional(),
  flops: z.array(flopSchema).max(MAX_FLOPS).optional().describe("An explicit flop subset"),
});

export const handsFilterSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("all") }),
  z.strictObject({ mode: z.literal("manual"), hands: z.array(handClassSchema).min(1).max(MAX_HANDS) }),
  z.strictObject({ mode: z.literal("close_decisions") }),
]);

const spotFilterShape = {
    game_config: drillGameConfigSchema,
    stake: z.string().min(1).max(MAX_STAKE_LABEL_LENGTH).describe("A catalog stake label: 1/3, 2/5, online"),
    sizing: sizingSchema,
    start_street: streetSchema,
    hero_positions: z.array(positionSchema).min(1).max(MAX_POSITIONS),
    villain_positions: z.array(positionSchema).max(MAX_POSITIONS).describe("Empty means any opponent"),
    preflop_action: z.array(z.enum(PREFLOP_ACTIONS)).min(1).max(PREFLOP_ACTIONS.length),
    line: lineSchema.optional(),
    board: boardFilterSchema.optional(),
    hands: handsFilterSchema,
    alternate_seats: z.boolean(),
};

/**
 * The spot filter as stored and served: its shape only. Rows are read and responses are checked
 * against this, so a drill written before a cross-field rule existed still lists (the rules apply
 * when a drill is written, not when it is read).
 */
export const storedSpotFilterSchema = z.strictObject(spotFilterShape).meta({ id: "SpotFilter" });

/** The spot filter a request writes: the shape plus the cross-field rules (spot-filter-rules.ts). */
export const spotFilterSchema = z
  .strictObject(spotFilterShape)
  .superRefine(checkSpotFilter)
  .meta({
    id: "SpotFilterWrite",
    description:
      "A spot filter as written; also checked across fields (seated positions, disjoint seats, stake by format, no duplicates, three distinct cards in each board flop)",
  });

export const trainerSettingsSchema = z
  .strictObject({
    stop_rule: z.enum(["after_action", "end_of_street", "end_of_hand"]),
    input: z.enum(["actions", "frequency"]),
    grouping: z.enum(["standard", "grouped", "simple"]),
    rng: z.boolean().describe("Mixed-frequency mode (the wire name stays rng; 05 section 7, ADR 0024, O-344); off by default"),
    pause: z.enum(["after_mistake", "every_action", "never"]),
    speed: z.enum(["slow", "normal", "fast"]),
    quick_result: z.boolean(),
    tables: z.number().int().min(1).max(MAX_TABLES),
    timebank_s: z
      .union([z.literal(TIMEBANK_SECONDS[0]), z.literal(TIMEBANK_SECONDS[1]), z.literal(TIMEBANK_SECONDS[2])])
      .nullable()
      .describe("Seconds per decision; null is off"),
    panels: z.strictObject(panelsShape).describe("Panel visibility; an absent key is off"),
  })
  .meta({ id: "TrainerSettings" });

export const tagSchema = z.string().regex(TAG_PATTERN);

export const drillSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    tags: z.array(z.string()),
    spot_filter: storedSpotFilterSchema,
    trainer: trainerSettingsSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .meta({ id: "Drill" });

export const drillCreateBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_DRILL_NAME_LENGTH),
    tags: z.array(tagSchema).max(MAX_TAGS).default([]),
    spot_filter: spotFilterSchema,
    trainer: trainerSettingsSchema,
  })
  .meta({ id: "DrillCreate" });

export const drillPatchBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_DRILL_NAME_LENGTH).optional(),
    tags: z.array(tagSchema).max(MAX_TAGS).optional(),
    spot_filter: spotFilterSchema.optional(),
    trainer: trainerSettingsSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "at least one field is required" })
  .meta({ id: "DrillPatch" });

export const drillsQuerySchema = pageQuerySchema.extend({
  tag: tagSchema.optional().describe("Only drills carrying this tag"),
});

export const drillPageSchema = pageSchema(drillSchema);

/** The longest export code import accepts (O-310, drills/export-code.ts). */
export const MAX_EXPORT_CODE_LENGTH = 8192;
/** Format version 1 of g-tee-oh's export code (O-310); published as the export response's pattern. */
export const EXPORT_CODE_PREFIX = "gteeoh1.";

export const drillExportSchema = z.object({
  export_code: z
    .string()
    .startsWith(EXPORT_CODE_PREFIX)
    .describe(`g-tee-oh's own encoding of a drill (O-310); starts with ${EXPORT_CODE_PREFIX}`),
});

export const drillImportBodySchema = z.strictObject({
  export_code: z.string().min(1).max(MAX_EXPORT_CODE_LENGTH),
});

export type SpotFilter = z.infer<typeof spotFilterSchema>;
export type TrainerSettings = z.infer<typeof trainerSettingsSchema>;
export type Drill = z.infer<typeof drillSchema>;
export type DrillCreateBody = z.infer<typeof drillCreateBodySchema>;
export type DrillPatchBody = z.infer<typeof drillPatchBodySchema>;
