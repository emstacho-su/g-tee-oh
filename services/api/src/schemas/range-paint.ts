/**
 * Range painting schemas (R3.17, 05 section 8, A5 section 3), settled by S27 (O-300, O-302, O-303).
 *
 * Mechanism: a range_paint session is drill-backed (POST /sessions mode range_paint). GET next
 * derives the node to paint from the session seed and counter (pure); POST submit sends one action
 * index for every hand class the acting seat holds there, and the api relays solver-query's
 * POST /v1/grade-range unchanged: each class's EV (expected value) loss in big blinds, its weight
 * (acting reach times combos over the node's reach-weighted combos) and the weighted sum, all
 * computed in Rust (ADR 0004). Painting is unrated and writes no attempt row.
 */
import { z } from "zod";

import { nodeActionSchema } from "./study.js";
import { handClassSchema, nodeKeySchema, positionSchema, uuidSchema } from "./common.js";

export const rangePaintParamsSchema = z.object({ session: uuidSchema });

export const rangePaintPromptSchema = z
  .object({
    session_id: uuidSchema,
    state_version: z.number().int().min(0),
    prompt_no: z.number().int().min(0),
    solution_id: uuidSchema,
    node_key: nodeKeySchema,
    spot_class_key: z.string(),
    hero_position: positionSchema,
    history: z.array(z.object({ position: positionSchema, token: z.string(), label: z.string() })),
    actions: z.array(nodeActionSchema).describe("The brushes: the node's tree actions (ADR 0020)"),
    hands: z.array(handClassSchema).describe("Every class the acting seat holds at the node; each must be painted"),
    synthetic: z.boolean().describe("True when the node's solution is synthetic test data (O-57)"),
  })
  .meta({ id: "RangePaintPrompt" });

export const rangePaintBodySchema = z.strictObject({
  session_id: uuidSchema,
  state_version: z.number().int().min(0),
  node_key: nodeKeySchema,
  paint: z
    .record(handClassSchema, z.number().int().min(0))
    .describe("Hand class to the NodeAction.index painted for it; every class of the prompt"),
});

export const paintedHandGradeSchema = z.object({
  hand: handClassSchema,
  action_index: z.number().int().min(0),
  best_action_index: z.number().int().min(0),
  loss_bb: z.number().describe("The class's EV loss in bb for the painted action"),
  loss_pct_pot: z.number(),
  weight: z.number().describe("Acting reach times combos over the node's reach-weighted combos"),
  weighted_loss_bb: z.number(),
});

export const rangePaintResultSchema = z
  .object({
    session_id: uuidSchema,
    state_version: z.number().int().min(0),
    node_key: nodeKeySchema,
    floor_pct_pot: z.number(),
    total_weighted_loss_bb: z.number().describe("solver-query's sum of weighted_loss_bb over every class (O-300)"),
    per_hand: z.array(paintedHandGradeSchema),
  })
  .meta({ id: "RangePaintResult" });
