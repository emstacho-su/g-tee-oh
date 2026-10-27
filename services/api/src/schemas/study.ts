/**
 * Study and coverage schemas (R3.3, R3.4, A5 section 3), declared by S21 for the contract-first
 * commit (O-38) and built by S23. The node shape follows solver-query's NodeResponse (A5 section 2)
 * so the api relays it without renaming; numbers come from Rust and are never recomputed here
 * (ADR 0004). S23 may change these shapes with a visible contract diff.
 */
import { z } from "zod";

import {
  boardSchema,
  configIdSchema,
  flopSchema,
  handSchema,
  lineSchema,
  nodeKeySchema,
  positionPairSchema,
  positionSchema,
  streetSchema,
  uuidSchema,
} from "./common.js";

export const actionKindSchema = z.enum(["fold", "check", "call", "limp", "straddle", "bet", "raise", "all_in"]);
export const noiseFlagSchema = z.enum(["close_ev_mix", "rare_line", "suit_mixing"]);

export const nodeActionSchema = z
  .object({
    index: z.number().int().min(0),
    token: z.string(),
    kind: actionKindSchema,
    size_cbb: z.number().int().nullable(),
    bucket: z.string().nullable(),
    label: z.string(),
  })
  .meta({ id: "NodeAction" });

export const nodeHandRowSchema = z
  .object({
    hand: z.string(),
    strategy: z.array(z.number()),
    ev_bb: z.array(z.number()),
    ev_best_bb: z.number(),
    loss_pct_pot: z.array(z.number()),
    reach: z.array(z.number()).nullable(),
  })
  .meta({ id: "NodeHandRow" });

export const studyNodeQuerySchema = z.object({
  config_id: configIdSchema,
  pair: positionPairSchema,
  line: lineSchema.optional().describe("The preflop action path; the pair's root when absent"),
  board: boardSchema.optional(),
  hand: handSchema.optional().describe("Restrict the rows to one hand"),
});

export const studyNodeSchema = z
  .object({
    solution_id: uuidSchema,
    node_key: nodeKeySchema,
    config_id: configIdSchema,
    pair: positionPairSchema,
    street: streetSchema,
    to_act: positionSchema,
    pot_cbb: z.number().int(),
    stacks_cbb: z.array(z.number().int()),
    floor_pct_pot: z.number(),
    spot_class_key: z.string().nullable(),
    actions: z.array(nodeActionSchema),
    hands: z.array(nodeHandRowSchema),
    noise_flags: z.array(noiseFlagSchema),
    next_likely_line: lineSchema.nullable().describe("The line the api prefetched next (R3.3)"),
  })
  .meta({ id: "StudyNode" });

export const studyInsightsQuerySchema = z.object({
  solution_id: uuidSchema,
  node_key: nodeKeySchema,
  hand: handSchema,
});

export const studyInsightsSchema = z
  .object({
    threshold_card: z.record(z.string(), z.unknown()),
    equity_distribution: z.record(z.string(), z.unknown()),
    range_advantage: z.record(z.string(), z.unknown()),
    nut_advantage: z.record(z.string(), z.unknown()),
    blockers: z.record(z.string(), z.unknown()),
    hand_role: z.string(),
    noise_flags: z.array(noiseFlagSchema),
  })
  .meta({
    id: "StudyInsights",
    description: "solver-query's InsightsResponse relayed as is; S23 pins the inner shapes",
  });

export const turnRootsQuerySchema = z.object({
  config_id: configIdSchema,
  pair: positionPairSchema,
  line: lineSchema,
  flop: flopSchema,
});

export const turnRootsSchema = z.object({
  roots: z.array(z.object({ turn: z.string(), node_key: nodeKeySchema, solution_id: uuidSchema })),
});

export const coverageQuerySchema = z.object({
  config_id: configIdSchema,
  pair: positionPairSchema,
});

export const coverageSchema = z
  .object({
    config_id: configIdSchema,
    pair: positionPairSchema,
    preflop_available: z.boolean(),
    flops: z.array(z.object({ flop: z.string(), texture_family: z.string(), scenarios: z.number().int() })),
    queue: z.array(
      z.object({ job_id: uuidSchema, flop: z.string(), priority: z.number(), position: z.number().int() }),
    ),
  })
  .meta({ id: "Coverage" });

export const coverageRequestBodySchema = z.strictObject({
  config_id: configIdSchema,
  pair: positionPairSchema,
  flop: flopSchema.optional(),
  line: lineSchema.optional(),
});

export const coverageRequestResultSchema = z.object({
  job_id: uuidSchema.nullable().describe("The raised build job; null when the spot is already covered"),
  priority: z.number().nullable(),
  queue_position: z.number().int().nullable(),
});
