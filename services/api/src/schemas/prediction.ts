/**
 * Prediction drill schemas (R3.16, 05 section 8, A5 section 3), settled by S27 (O-301, O-302, O-303).
 *
 * Mechanism: a prediction session is drill-backed (POST /sessions mode prediction). GET next derives
 * the prompt from the session seed and its answered counter, so it writes nothing and carries no
 * strategy: the truth stays on the server until the answer. Two ladders run per spot class: the
 * range ladder (1 more or less than a threshold share, 2 the share to the nearest 5 percent, 3 which
 * hand regions mix) and the hand ladder (1 the hand's most frequent action, 2 the frequency band of
 * a named action, 3 the size the hand raises with most). Every truth is a Rust number or flag read
 * from solver-query and only compared here (ADR 0004). Answers are unrated and write no attempt row.
 */
import { z } from "zod";

import { nodeActionSchema } from "./study.js";
import { handClassSchema, nodeKeySchema, positionSchema, uuidSchema } from "./common.js";

export const predictionLadderSchema = z.enum(["range", "hand"]);
export const PREDICTION_LEVELS = [1, 2, 3] as const;
export const predictionLevelSchema = z.number().int().min(1).max(PREDICTION_LEVELS.length);

/** The answer kind each ladder level asks for (O-301). */
export const predictionAnswerKindSchema = z.enum(["yes_no", "percent", "regions", "action", "band", "size"]);

/** Named hand regions of the 13 by 13 grid for the range ladder's third level (naming data only). */
export const handRegionSchema = z.enum([
  "pairs",
  "suited_aces",
  "suited_broadways",
  "suited_connectors",
  "suited_other",
  "offsuit_aces",
  "offsuit_broadways",
  "offsuit_other",
]);

/** Frequency bands of the hand ladder's second level, in percent of the hand's strategy. */
export const frequencyBandSchema = z.enum(["0_25", "25_50", "50_75", "75_100"]);

export const predictionParamsSchema = z.object({ session: uuidSchema });

export const predictionPromptSchema = z
  .object({
    prompt_id: uuidSchema.describe("Derived from the session and its counter, so a repeat GET answers the same prompt"),
    session_id: uuidSchema,
    state_version: z.number().int().min(0),
    ladder: predictionLadderSchema,
    level: predictionLevelSchema,
    answer_kind: predictionAnswerKindSchema,
    question: z.string(),
    spot_class_key: z.string(),
    node_key: nodeKeySchema,
    hero_position: positionSchema,
    history: z.array(z.object({ position: positionSchema, token: z.string(), label: z.string() })),
    hand: handClassSchema.nullable().describe("The hand class the hand ladder asks about; null on the range ladder"),
    actions: z.array(nodeActionSchema).describe("The node's tree actions (ADR 0020), for action and size answers"),
    action_index: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe("The NodeAction.index the question names (threshold, nearest share, band); null otherwise"),
    threshold_pct: z.number().min(0).max(100).nullable().describe("The yes or no question's threshold; null otherwise"),
    regions: z.array(handRegionSchema).nullable().describe("The regions to choose from on the mixing level; null otherwise"),
    bands: z.array(frequencyBandSchema).nullable().describe("The bands to choose from on the band level; null otherwise"),
    synthetic: z.boolean().describe("True when the node's solution is synthetic test data (O-57)"),
  })
  .meta({ id: "PredictionPrompt" });

export const predictionAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("yes_no"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("percent"), value: z.number().min(0).max(100) }),
  z.strictObject({ kind: z.literal("regions"), value: z.array(handRegionSchema).max(handRegionSchema.options.length) }),
  z.strictObject({ kind: z.literal("action"), action_index: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal("band"), band: frequencyBandSchema }),
  z.strictObject({ kind: z.literal("size"), action_index: z.number().int().min(0) }),
]);

/** The typed reason's bounds after cleaning (O-412, with the PM's change to 1,000 characters). */
export const RATIONALE_MIN_CHARS = 3;
export const RATIONALE_MAX_CHARS = 1000;

export const predictionAnswerBodySchema = z.strictObject({
  prompt_id: uuidSchema,
  state_version: z.number().int().min(0),
  answer: predictionAnswerSchema,
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(RATIONALE_MAX_CHARS)
    .describe(
      "Why the player answered so (S41, O-350, O-412): required, 3 to 1,000 characters after control and invisible characters are cleaned; stored with the answer, never graded",
    ),
});

export const predictionResultSchema = z
  .object({
    prompt_id: uuidSchema,
    correct: z.boolean(),
    ladder: predictionLadderSchema,
    level: predictionLevelSchema.describe("The level the answer was given at"),
    truth: z.object({
      text: z.string().describe("The solver's answer in words, built from the numbers below"),
      share_pct: z.number().nullable(),
      frequency_pct: z.number().nullable(),
      action_indexes: z.array(z.number().int()).nullable(),
      regions: z.array(handRegionSchema).nullable(),
      band: frequencyBandSchema.nullable(),
    }),
    window: z.object({
      answers: z.number().int().min(0).describe("Answers counted at this level, at most the window size"),
      correct: z.number().int().min(0),
      size: z.number().int().min(1),
      required_pct: z.number(),
    }),
    next_level_unlocked: z.boolean(),
    level_passed: z
      .boolean()
      .describe("The last 20 answers at this spot class, ladder and level hold at least 90 percent correct (S41, O-410)"),
    new_level: predictionLevelSchema.describe("The ladder's level for this spot class after the answer"),
    state_version: z.number().int().min(0),
  })
  .meta({ id: "PredictionResult" });
