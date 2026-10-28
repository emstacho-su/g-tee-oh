/**
 * Your frequency against the solver's (R4.12, S41, O-353, O-417, O-418): GET /progress/frequencies.
 *
 * Mechanism: per preflop decision node the user played (node_key, the 12 most played), the share
 * of the user's counted decisions that chose each action next to the mean of the solver's stored
 * frequency for the same dealt hands, pooled over the node and per hand class. Frequencies are 0 to
 * 1 and aligned with actions. Every solver number is a stored Rust number averaged over the user's
 * own decisions (product statistics, as drift does, O-304); nothing new is computed (ADR 0004).
 */
import { z } from "zod";

import { configIdSchema, handClassSchema, nodeKeySchema, positionPairSchema, positionSchema } from "./common.js";

/** A spot's pooled comparison shows from this many counted decisions at its node (O-417). */
export const MIN_SPOT_DECISIONS = 30;
/** A hand class row shows from this many counted decisions (O-417). */
export const MIN_HAND_DECISIONS = 10;
/** The most played nodes the view lists (O-418). */
export const MAX_FREQUENCY_SPOTS = 12;

const frequenciesSchema = z.array(z.number().min(0).max(1));

export const frequencyActionSchema = z
  .object({
    index: z.number().int().min(0).describe("NodeAction.index, the position in the node's actions"),
    label: z.string(),
    kind: z.string(),
  })
  .meta({ id: "FrequencyAction" });

export const frequencyRowSchema = z
  .object({
    your_freq: frequenciesSchema.describe("The share of your decisions that chose each action"),
    solver_freq: frequenciesSchema.describe("The mean of the solver's frequency of each action for the hands you were dealt"),
  })
  .meta({ id: "FrequencyRow" });

export const handFrequencySchema = frequencyRowSchema
  .extend({ hand_class: handClassSchema, decisions: z.number().int().min(1) })
  .meta({ id: "HandFrequency" });

export const spotFrequencySchema = z
  .object({
    node_key: nodeKeySchema,
    spot_class_key: z.string(),
    config_id: configIdSchema,
    pair: positionPairSchema,
    hero_position: positionSchema,
    action_family: z.string().nullable().describe("solver-query's action family of the node"),
    decisions: z.number().int().min(1).describe("Your counted decisions at this node"),
    actions: z.array(frequencyActionSchema),
    pooled: frequencyRowSchema.nullable().describe("Every hand pooled; null below min_spot_decisions"),
    hands: z.array(handFrequencySchema).describe("Hand classes at or above min_hand_decisions, the largest gap first"),
  })
  .meta({ id: "SpotFrequency" });

export const frequencyComparisonSchema = z
  .object({
    min_spot_decisions: z.number().int().min(1),
    min_hand_decisions: z.number().int().min(1),
    spots: z.array(spotFrequencySchema).max(MAX_FREQUENCY_SPOTS).describe("The most played preflop nodes, most decisions first"),
  })
  .meta({ id: "FrequencyComparison" });

export type FrequencyComparison = z.infer<typeof frequencyComparisonSchema>;
export type SpotFrequency = z.infer<typeof spotFrequencySchema>;
export type HandFrequency = z.infer<typeof handFrequencySchema>;
