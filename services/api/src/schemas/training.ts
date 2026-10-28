/**
 * Training, prediction and range-painting schemas (R3.6, R3.7, R3.16, R3.17, A5 section 3, A6
 * section 2), declared by S21 for the contract-first commit (O-38). S23 builds the sessions, S27
 * prediction and painting. Every decision carries the state_version the client last saw, so a
 * stale or double-submitted decision is detected (A5 section 3); the owners may change these
 * shapes with a visible contract diff. S23 added, additively: the optional session seed on
 * POST /sessions (O-249, O-151), and the prompt's street, rng_roll and previous_board. S31 added,
 * additively (R4.10, R4.12, R4.13, O-270 to O-279): the automated scope (config_ids) and the holdout
 * track on POST /sessions, the session's rated_eligible flag with its automated block and holdout
 * progress, the prompt's class and track, the feedback's item difficulty and review block, and the
 * recap's rating changes, tier and unlocks.
 */
import { z } from "zod";

import { nodeActionSchema, noiseFlagSchema } from "./study.js";
import {
  cardSchema,
  configIdSchema,
  nodeKeySchema,
  positionPairSchema,
  positionSchema,
  streetSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";
import { trainerSettingsSchema } from "./drills.js";
import { TRACK_KEYS } from "../learning/tracks.js";

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
export const trackKeySchema = z.enum(TRACK_KEYS).describe("A v1 rating track (O-271)");
export const fsrsGradeSchema = z.enum(["Again", "Hard", "Good", "Easy"]);

/** The most configurations one automated session may scope (R4.10). */
export const MAX_SESSION_CONFIG_IDS = 32;

/** A 64-bit seed or generator state as sixteen lowercase hexadecimal digits, as solver-query writes it (O-151). */
export const HEX64_PATTERN = /^[0-9a-f]{16}$/;
export const hex64Schema = z.string().regex(HEX64_PATTERN).describe("Sixteen lowercase hexadecimal digits (O-151)");

export const sessionCreateBodySchema = z.strictObject({
  mode: practiceModeSchema,
  drill_id: uuidSchema.optional().describe("Required when mode is drill"),
  settings: trainerSettingsSchema.partial().optional(),
  seed: hex64Schema
    .optional()
    .describe(
      "The session seed; the same seed and choices replay the same session (O-249). Random when absent. A session created with a seed is never rated and writes no learning state; holdout sessions refuse a seed with 400",
    ),
  config_ids: z
    .array(configIdSchema)
    .min(1)
    .max(MAX_SESSION_CONFIG_IDS)
    .optional()
    .describe("Automated mode: the configurations in scope; every catalog configuration with preflop coverage when absent"),
  track_key: trackKeySchema.optional().describe("Holdout mode: retest one track only; every track when absent"),
});

export const automatedBlockSchema = z
  .object({
    spot_class_key: z.string(),
    track_key: trackKeySchema.nullable(),
    family: z.string(),
    served: z.number().int().min(0).describe("Hands of the block served so far"),
    size: z.number().int().min(1).describe("Hands in the block (O-272)"),
    worked_example: z.boolean().describe("A first exposure: every panel visible, unrated (O-272)"),
  })
  .meta({ id: "AutomatedBlock" });

export const holdoutProgressSchema = z
  .object({
    round_month: z.iso.date().describe("The first day of the round's month"),
    answered: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .meta({ id: "HoldoutProgress" });

export const sessionSchema = z
  .object({
    session_id: uuidSchema,
    mode: practiceModeSchema,
    drill_id: uuidSchema.nullable(),
    state: sessionStateSchema,
    state_version: z.number().int().min(0),
    started_at: timestampSchema,
    rated_eligible: z
      .boolean()
      .describe("True when decisions may be rated: false for drill, holdout and seeded automated sessions"),
    automated: automatedBlockSchema.nullable().describe("The current block of an automated session; null otherwise"),
    holdout: holdoutProgressSchema.nullable().describe("The round progress of a holdout session; null otherwise"),
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
    synthetic: z
      .boolean()
      .describe("True when the node's solution is synthetic test data, for the banner (O-229, O-57, O-280)"),
    spot_class_key: z.string().nullable().describe("The decision's spot class, as solver-query names it"),
    track_key: trackKeySchema.nullable().describe("The class's rating track; null for a class no track takes"),
    worked_example: z.boolean().describe("True on a worked-example block of an automated session (O-272)"),
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

export const reviewBlockSchema = z
  .object({
    spot_class_key: z.string(),
    closed: z.boolean(),
    fsrs_grade: fsrsGradeSchema.nullable().describe("Null for a worked-example block (O-272)"),
    next_due: timestampSchema.nullable(),
    p_known: z.number().nullable(),
  })
  .meta({ id: "ReviewBlock" });

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
    // O-280, O-281: where the decision was made, read from the attempt row and its solution row
    // (O-246), so the feedback panel can fetch the range view and threshold card for that node.
    solution_id: uuidSchema.describe("The solution the decision was graded against"),
    node_key: nodeKeySchema.describe("The node the hero decided at"),
    config_id: configIdSchema,
    pair: positionPairSchema,
    hand: z.string().describe("The hero's hand as graded"),
    item_difficulty: z.number().nullable().describe("The item's difficulty for rating (O-274); null when not computed"),
    review_block: reviewBlockSchema.nullable().describe("Set when this decision closed an automated review block"),
    // S27 (O-303, R3.18): the noise flags the decision was graded with (05 section 9: graded for
    // feedback, excluded from the rating) and its Rust spot class, the node family drift reads.
    noise_flags: z.array(noiseFlagSchema).describe("Flags from solver-query; any flag makes the decision unrated (05 section 9)"),
    spot_class_key: z.string().describe("Rust's spot class of the node, the node family of range drift (O-304)"),
  })
  .meta({ id: "DecisionFeedback" });

export const tierSchema = z.enum(["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]);
const ratingFigureSchema = z.object({ mu: z.number(), rd: z.number() });

export const recapSchema = z
  .object({
    session_id: uuidSchema,
    ended_at: timestampSchema,
    decisions: z.number().int(),
    rated_decisions: z.number().int(),
    mean_score: z.number().nullable(),
    ev_loss_bb_total: z.number(),
    rating_changes: z
      .array(z.object({ track_key: trackKeySchema, before: ratingFigureSchema.nullable(), after: ratingFigureSchema }))
      .describe("One entry per track the session rated (O-27)"),
    tier: z
      .object({
        overall: z.number(),
        tier: tierSchema,
        band_tier: tierSchema,
        blocked_by: z.array(trackKeySchema),
      })
      .nullable()
      .describe("The overall tier after the session; null when nothing was rated"),
    unlocks: z.array(z.string()).describe("Cosmetic keys the session unlocked (O-279)"),
  })
  .meta({ id: "SessionRecap" });
