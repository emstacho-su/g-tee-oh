/**
 * Catalog schemas (R3.2, A4 section 2, ADR 0014). Stakes are returned as stored: cents and basis
 * points, with no rake arithmetic in TypeScript (ADR 0004). A configuration carries its stake, so
 * two configurations that differ only by stake (1/3 against 2/5 at the same table size and depth)
 * are two config_id values (criterion 11, R2.2). Pairs list every canonical position pair seated
 * at the configuration's table size (O-234).
 */
import { z } from "zod";

import { pageQuerySchema, pageSchema } from "../http/pagination.js";
import {
  configIdSchema,
  gameFormatSchema,
  positionPairSchema,
  positionSchema,
  tableSizeSchema,
  uuidSchema,
} from "./common.js";

export const stakeSchema = z
  .object({
    id: uuidSchema,
    format: gameFormatSchema,
    label: z.string().describe("1/3, 2/5, or online for the online rake profile"),
    bb_cents: z.number().int(),
    rake_percent_bp: z.number().int().describe("Rake in basis points: 1000 is 10 percent"),
    rake_cap_cents: z.number().int(),
    no_flop_no_drop: z.boolean(),
    note: z.string().nullable().describe("A flag such as the unverified 2/5 cap (O-66, O-71)"),
  })
  .meta({ id: "Stake" });

export const stakesQuerySchema = pageQuerySchema.extend({
  format: gameFormatSchema.optional(),
});

export const stakePageSchema = pageSchema(stakeSchema);

export const gameConfigSchema = z
  .object({
    config_id: configIdSchema,
    format: gameFormatSchema,
    table_size: tableSizeSchema,
    stake_id: uuidSchema,
    stake_label: z.string(),
    depth_cbb: z.number().int().describe("Effective stack in centi-big-blinds"),
    straddle: z.boolean(),
    ante_cbb: z.number().int().describe("Ante in centi-big-blinds; stored but not served in v1 (O-33)"),
  })
  .meta({ id: "GameConfig" });

export const configsQuerySchema = pageQuerySchema.extend({
  format: gameFormatSchema.optional(),
  stake_id: uuidSchema.optional(),
  table_size: z.coerce.number().int().min(2).max(9).optional(),
});

export const configPageSchema = pageSchema(gameConfigSchema);

export const positionPairEntrySchema = z
  .object({
    pair: positionPairSchema,
    oop: positionSchema,
    ip: positionSchema,
    preflop_available: z.boolean().describe("A published preflop solution covers this pair"),
  })
  .meta({ id: "PositionPairEntry" });

export const pairsQuerySchema = pageQuerySchema;

export const pairPageSchema = pageSchema(positionPairEntrySchema).extend({
  config_id: configIdSchema,
});

export type Stake = z.infer<typeof stakeSchema>;
export type GameConfig = z.infer<typeof gameConfigSchema>;
export type PositionPairEntry = z.infer<typeof positionPairEntrySchema>;
