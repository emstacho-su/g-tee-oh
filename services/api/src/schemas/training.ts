/**
 * Training, prediction and range-painting schemas (R3.6, R3.7, R3.16, R3.17, A5 section 3, A6
 * section 2), declared by S21 for the contract-first commit (O-38). S23 builds the sessions, S27
 * prediction and painting. Every decision carries the state_version the client last saw, so a
 * stale or double-submitted decision is detected (A5 section 3); the owners may change these
 * shapes with a visible contract diff. S23 added, additively: the optional session seed on
 * POST /sessions (O-249, O-151), and the prompt's street, rng_roll and previous_board.
 */
import { z } from "zod";

import { nodeActionSchema } from "./study.js";
import {
  cardSchema,
  handClassSchema,
  nodeKeySchema,
  positionSchema,
  streetSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";
import { trainerSettingsSchema } from "./drills.js";

export const practiceModeSchema = z.enum(["automated", "drill", "holdout", "prediction", "range_paint"]);
export const sessionStateSchema = z.enum([
  "dealing",
  "await_hero",
  "opponent_acts",
  "feedback",
  "street_end",
  "reveal",
  "hand_end",
  "ended",
]);
export const gradeLabelSchema = z.enum(["best", "correct", "inaccuracy", "mistake", "blunder"]);
export const confidenceSchema = z.enum(["sure", "unsure"]);

/** A 64-bit seed or generator state as sixteen lowercase hexadecimal digits, as solver-query writes it (O-151). */
export const HEX64_PATTERN = /^[0-9a-f]{16}$/;
export const hex64Schema = z.string().regex(HEX64_PATTERN).describe("Sixteen lowercase hexadecimal digits (O-151)");

export const sessionCreateBodySchema = z.strictObject({
  mode: practiceModeSchema,
  drill_id: uuidSchema.optional().describe("Required when mode is drill"),
  settings: trainerSettingsSchema.partial().optional(),
  seed: hex64Schema
    .optional()
    .describe("The session seed; the same seed and choices replay the same session (O-249). Random when absent"),
});

export const sessionSchema = z
  .object({
    session_id: uuidSchema,
    mode: practiceModeSchema,
    drill_id: uuidSchema.nullable(),
    state: sessionStateSchema,
    state_version: z.number().int().min(0),
    started_at: timestampSchema,
  })
  .meta({ id: "PracticeSession" });

export const promptSchema = z
  .object({
    session_id: uuidSchema,
    state: sessionStateSchema,
    state_version: z.number().int().min(0),
    hero_position: positionSchema,
    hero_hand: z.array(cardSchema).length(2),
    board: z.array(cardSchema),
    pot_cbb: z.number().int(),
    stacks_cbb: z.array(z.number().int()),
    history: z.array(z.object({ position: positionSchema, token: z.string(), label: z.string() })),
    buttons: z.array(nodeActionSchema).describe("Generated from the node's tree actions (ADR 0020)"),
    visible_panels: z.array(z.string()),
    street: streetSchema.describe("The street of the node the hero acts at"),
    rng_roll: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .describe("The 1 to 100 roll of RNG mode, drawn before the hero acts; null when RNG mode is off (05 section 7)"),
    previous_board: z
      .array(cardSchema)
      .nullable()
      .describe("The board revealed when the previous hand ended (full-hand mode); null when none was"),
  })
  .meta({ id: "TrainerPrompt" });

export const decisionBodySchema = z.strictObject({
  state_version: z.number().int().min(0),
  action_index: z.number().int().min(0),
  size_cbb: z.number().int().positive().optional(),
  confidence: confidenceSchema.optional(),
  response_ms: z.number().int().min(0),
  prediction_answer: z.number().min(0).max(100).optional(),
});

export const feedbackSchema = z
  .object({
    attempt_id: uuidSchema,
    label: gradeLabelSchema,
    score: z.number(),
    ev_loss_bb: z.number(),
    ev_loss_pct_pot: z.number(),
    best_action_indexes: z.array(z.number().int()),
    freq_by_action: z.array(z.number()),
    ev_by_action: z.array(z.number()),
    rated: z.boolean(),
    rng_roll: z.number().int().nullable(),
    state_version: z.number().int().min(0),
  })
  .meta({ id: "DecisionFeedback" });

export const recapSchema = z
  .object({
    session_id: uuidSchema,
    ended_at: timestampSchema,
    decisions: z.number().int(),
    rated_decisions: z.number().int(),
    mean_score: z.number().nullable(),
    ev_loss_bb_total: z.number(),
  })
  .meta({ id: "SessionRecap" });

export const predictionParamsSchema = z.object({ session: uuidSchema });

export const predictionPromptSchema = z.object({
  prompt_id: uuidSchema,
  level: z.number().int().min(1),
  node_key: nodeKeySchema,
  question: z.string(),
  hand: handClassSchema.nullable(),
});

export const predictionAnswerBodySchema = z.strictObject({
  prompt_id: uuidSchema,
  answer_pct: z.number().min(0).max(100),
});

export const predictionResultSchema = z.object({
  correct_pct: z.number(),
  error_pct_points: z.number(),
  within_tolerance: z.boolean(),
  level: z.number().int().min(1),
  next_level_unlocked: z.boolean(),
});

export const rangePaintBodySchema = z.strictObject({
  session_id: uuidSchema,
  node_key: nodeKeySchema,
  paint: z
    .record(handClassSchema, z.number().int().min(0))
    .describe("Hand class to the action index painted for it"),
});

export const rangePaintResultSchema = z.object({
  total_ev_loss_bb: z.number(),
  per_hand: z.array(z.object({ hand: handClassSchema, ev_loss_bb: z.number() })),
});
