/**
 * The builder settings an admin may store (R3.5, A1 section 6, O-88, O-188, O-241). The key list
 * and each value's JSON type mirror the builder's own settings table (its KEYS array and per-key
 * checks); test/admin-settings-keys.test.ts reads the builder's source and fails when the keys or
 * the ceilings below drift from it.
 *
 * Mechanism: each key has a Zod schema for its JSON type and the bounds that are cheap to state
 * here (positive whole numbers under the builder's MAX_* ceilings, shares above 0 and at most 1,
 * hours 0 to 23). Semantic checks that need the builder's own knowledge (a plan_configs id that
 * is not a v1 configuration, 16-bit storage under the O-194 target floor, the deploy-time memory
 * and budget ceilings) stay in the builder, which reports them as settings errors on its health
 * probe and falls back to its default for that key alone (O-188).
 */
import { z } from "zod";

import { configIdSchema } from "../schemas/common.js";

/** The builder's ceilings the api checks, by the builder's constant name. */
export const BUILDER_SETTING_CEILINGS = {
  MAX_K_FREQUENT_PAIRS: 1326,
  MAX_SECONDS_PER_LINE: 86_400,
  MAX_ITERATIONS: 1_000_000,
  MAX_POLL_SECONDS: 3600,
  MAX_STALE_HOURS: 168,
  MAX_VERIFY_INTERVAL_HOURS: 720,
  MAX_PLAN_INTERVAL_MINUTES: 10_080,
  MAX_ATTEMPTS: 100,
  MAX_TARGET_PCT_POT: 100,
} as const;

/** Every ordered turn and river pair of a flop: the builder's k_runouts ceiling. */
export const MAX_K_RUNOUTS = 2352;
/** One gibibyte: the builder's ceiling on bytes_per_runout and bytes_per_flop_tree. */
export const MAX_BYTES_PER_ITEM = 1024 * 1024 * 1024;
const LAST_HOUR = 23;
/** The boost window's UTC offset must stay within a day, in minutes. */
const MAX_UTC_OFFSET_MINUTES = 24 * 60 - 1;
const STORAGE_BITS = [16, 32] as const;

const ceilings = BUILDER_SETTING_CEILINGS;

const shareSchema = z.number().gt(0).max(1).describe("A share of the solve threads, above 0 and at most 1");
const hourSchema = z.int().min(0).max(LAST_HOUR);

function bounded(ceiling: number) {
  return z.int().positive().max(ceiling);
}

/** Each key's JSON value schema, in the builder's KEYS order. */
export const builderSettingValueSchemas = {
  paused: z.boolean(),
  cpu_share: shareSchema,
  overnight: z.strictObject({
    start_hour: hourSchema,
    end_hour: hourSchema,
    utc_offset_minutes: z.int().min(-MAX_UTC_OFFSET_MINUTES).max(MAX_UTC_OFFSET_MINUTES),
    cpu_share: shareSchema,
  }),
  budget_bytes: z.int().positive(),
  bytes_per_runout: bounded(MAX_BYTES_PER_ITEM),
  bytes_per_flop_tree: bounded(MAX_BYTES_PER_ITEM),
  k_runouts: bounded(MAX_K_RUNOUTS),
  k_runouts_rare: bounded(MAX_K_RUNOUTS),
  k_frequent_pairs: bounded(ceilings.MAX_K_FREQUENT_PAIRS),
  plan_configs: z.array(configIdSchema).describe("Configuration ids the planner enumerates; [] turns planning off"),
  target_pct_pot: z.number().gt(0).max(ceilings.MAX_TARGET_PCT_POT),
  max_iterations: bounded(ceilings.MAX_ITERATIONS),
  max_seconds_per_line: bounded(ceilings.MAX_SECONDS_PER_LINE),
  storage_bits: z.literal(STORAGE_BITS),
  memory_cap_bytes: z.int().positive(),
  max_attempts: bounded(ceilings.MAX_ATTEMPTS),
  stale_hours: bounded(ceilings.MAX_STALE_HOURS),
  verify_interval_hours: bounded(ceilings.MAX_VERIFY_INTERVAL_HOURS),
  plan_interval_minutes: bounded(ceilings.MAX_PLAN_INTERVAL_MINUTES),
  poll_seconds: bounded(ceilings.MAX_POLL_SECONDS),
} as const;

export type BuilderSettingKey = keyof typeof builderSettingValueSchemas;

/** Every key the builder reads, in its order. */
export const BUILDER_SETTING_KEYS = Object.keys(builderSettingValueSchemas) as readonly BuilderSettingKey[];

/** The key of the setting that makes the builder claim nothing. */
export const PAUSED_KEY = "paused" satisfies BuilderSettingKey;
