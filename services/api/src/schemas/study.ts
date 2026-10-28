/**
 * Study and coverage schemas (R3.3, R3.4, A5 section 3), declared by S21 for the contract-first
 * commit (O-38) and built by S23. The node shape follows solver-query's NodeResponse (A5 section 2)
 * so the api relays it without renaming; numbers come from Rust and are never recomputed here
 * (ADR 0004). S23 may change these shapes with a visible contract diff.
 *
 * S23 changes, additive where S24's web already reads the shape: the node query takes an optional
 * node_key (a key solver-query handed out, O-245); StudyNode gains synthetic (O-229, O-57) and
 * next_likely_node_key; StudyInsights pins solver-query's InsightsResponse inner shapes, each
 * nullable where solver-query answers null; Coverage gains synthetic and database (O-172).
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
    next_node_key: nodeKeySchema
      .nullable()
      .describe("The node this action leads to; null when it ends the solution (O-245, O-280)"),
  })
  .meta({ id: "NodeAction" });

/** One action's share of the acting seat's reach-weighted range, as solver-query sums it (ADR 0004). */
export const actionShareSchema = z
  .object({
    index: z.number().int().min(0),
    share: z.number().min(0).max(1),
  })
  .meta({ id: "ActionShare" });

export const nodeHandRowSchema = z
  .object({
    hand: z.string(),
    strategy: z.array(z.number()),
    ev_bb: z.array(z.number()),
    ev_best_bb: z.number(),
    loss_pct_pot: z.array(z.number()),
    reach: z.array(z.number()).nullable(),
    mixed: z.boolean().describe("Two or more actions at 0.05 or more, as solver-query flags it (O-301)"),
  })
  .meta({ id: "NodeHandRow" });

export const studyNodeQuerySchema = z.object({
  config_id: configIdSchema,
  pair: positionPairSchema,
  line: lineSchema.optional().describe("The preflop action path; the pair's root when absent"),
  node_key: nodeKeySchema
    .optional()
    .describe("A node key solver-query handed out (a next_likely_node_key); excludes line (O-245)"),
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
    next_likely_node_key: nodeKeySchema
      .nullable()
      .describe("The node the api prefetched next; null when the likeliest action ends the solution (R3.3)"),
    synthetic: z.boolean().describe("True when the solution is synthetic test data (O-229, O-57)"),
    range_by_action: z
      .array(actionShareSchema)
      .describe("Each action's share of the acting seat's range, from solver-query's range summary (O-281, ADR 0004)"),
  })
  .meta({ id: "StudyNode" });

export const studyInsightsQuerySchema = z.object({
  solution_id: uuidSchema,
  node_key: nodeKeySchema,
  hand: handSchema,
});

/** The inner shapes of solver-query's InsightsResponse (packages/contracts solver-query.generated.ts). */
export const handRoleSchema = z.enum(["value", "marginal", "bluff", "fold", "trap"]);

export const thresholdCardSchema = z
  .object({
    actions: z.array(
      z.object({
        index: z.number().int().min(0),
        token: z.string(),
        share_taking: z.number(),
        weakest_hand_taking_half: z.string().nullable(),
      }),
    ),
    strongest_folding_hand: z.string().nullable(),
    hand_position: z.object({
      hand: z.string(),
      equity_vs_villain: z.number(),
      rank_in_range: z.number(),
      relative: z.array(z.object({ index: z.number().int().min(0), position: z.enum(["above", "at", "below"]) })),
    }),
  })
  .meta({ id: "ThresholdCard" });

export const equityDistributionSchema = z
  .object({ bin_edges: z.array(z.number()), oop: z.array(z.number()), ip: z.array(z.number()) })
  .meta({ id: "EquityDistribution" });

export const rangeAdvantageSchema = z
  .object({ oop_mean_equity: z.number(), ip_mean_equity: z.number(), to_act_advantage_pct_points: z.number() })
  .meta({ id: "RangeAdvantage" });

export const nutAdvantageSchema = z
  .object({ threshold_equity: z.number(), oop_share: z.number(), ip_share: z.number(), to_act_advantage: z.number() })
  .meta({ id: "NutAdvantage" });

export const blockersSchema = z
  .object({
    hand: z.string(),
    villain_combos_removed: z.number().int(),
    villain_reach_removed_share: z.number(),
    top_blocked: z.array(z.object({ hand: z.string(), reach_removed: z.number() })),
  })
  .meta({ id: "Blockers" });

export const studyInsightsSchema = z
  .object({
    threshold_card: thresholdCardSchema.nullable(),
    equity_distribution: equityDistributionSchema.nullable(),
    range_advantage: rangeAdvantageSchema.nullable(),
    nut_advantage: nutAdvantageSchema.nullable(),
    blockers: blockersSchema,
    hand_role: handRoleSchema.nullable(),
    noise_flags: z.array(noiseFlagSchema),
  })
  .meta({
    id: "StudyInsights",
    description: "solver-query's InsightsResponse relayed as is; a part it cannot answer at the node is null",
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

export const coverageDatabaseStateSchema = z
  .enum(["connected", "unconfigured", "unavailable"])
  .describe("Whether solver-query's database answered; flops and queue are empty unless connected (O-172)");

export const coverageSchema = z
  .object({
    config_id: configIdSchema,
    pair: positionPairSchema,
    preflop_available: z.boolean(),
    flops: z.array(z.object({ flop: z.string(), texture_family: z.string(), scenarios: z.number().int() })),
    queue: z.array(
      z.object({ job_id: uuidSchema, flop: z.string(), priority: z.number(), position: z.number().int() }),
    ),
    synthetic: z.boolean().describe("True when a held preflop solution is synthetic test data (O-229, O-57)"),
    database: coverageDatabaseStateSchema,
  })
  .meta({ id: "Coverage" });

export const coverageRequestBodySchema = z.strictObject({
  config_id: configIdSchema,
  pair: positionPairSchema,
  flop: flopSchema.optional(),
  line: lineSchema.optional(),
});

/**
 * What a coverage request did (O-240, PR #25 review M8): queued, the spot's queued build job was
 * raised to the queue head (or already was); blocked_budget, the spot's build job waits on the
 * storage budget, so it has no queue position, is not raised and the request is recorded;
 * recorded, no job could be raised (none, parked or past the queue) and the request is recorded
 * for the builder's planner; covered, the library already holds the spot and nothing was written.
 */
export const coverageRequestStatusSchema = z
  .enum(["queued", "blocked_budget", "recorded", "covered"])
  .describe(
    "queued: the build job was raised to the queue head; blocked_budget: the job waits on the storage budget, " +
      "has no queue position and keeps its priority, and the request is recorded; recorded: no job to raise, the " +
      "request is recorded for the planner; covered: the library already holds the spot, nothing was written",
  );

export const coverageRequestResultSchema = z.object({
  status: coverageRequestStatusSchema,
  job_id: uuidSchema
    .nullable()
    .describe("The spot's build job when status is queued or blocked_budget; null when recorded or covered"),
  priority: z.number().nullable().describe("The job's priority after the request; null when job_id is null"),
  queue_position: z
    .number()
    .int()
    .nullable()
    .describe("1 plus the queued jobs the builder claims first; null unless status is queued"),
});
