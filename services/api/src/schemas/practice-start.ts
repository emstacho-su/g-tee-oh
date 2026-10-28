/**
 * The catalog-spot start of a practice session and the quiz options (R3.16, R3.17, S41, O-350,
 * O-351, O-410, O-411, O-415), added to POST /sessions additively.
 *
 * - catalog_spot names a catalog configuration, the hero seats, the opponents (empty means any)
 *   and the preflop spot types (the drill's preflop action families, sessions/action-family.ts),
 *   instead of a drill. The shape rules live here: no list repeats a value and the hero and
 *   opponent seats are disjoint. Whether the configuration exists and whether every seat is seated
 *   at its table size need the catalog, so the handler checks them (sessions/modes/catalog-spot.ts).
 * - quiz sets a prediction session's difficulty (Easy, Medium and Hard ask levels 1, 2 and 3,
 *   O-410) and its question kinds (the range and hand ladders, O-411).
 */
import { z } from "zod";

import { configIdSchema, positionSchema } from "./common.js";
import { MAX_POSITIONS, PREFLOP_ACTIONS } from "./drills.js";
/**
 * The question kinds: the prediction ladders (schemas/prediction.ts predictionLadderSchema, held equal
 * by test). Declared here so this module does not import the prediction schemas, which would
 * reorder the contract components.
 */
export const QUIZ_QUESTION_KINDS = ["range", "hand"] as const;

/** The quiz difficulties in level order: Easy is level 1, Medium 2, Hard 3 (O-350, O-410). */
export const QUIZ_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type QuizDifficulty = (typeof QUIZ_DIFFICULTIES)[number];
const LADDER_COUNT = QUIZ_QUESTION_KINDS.length;

/** The prediction level a difficulty asks (O-410). */
export function levelOfDifficulty(difficulty: QuizDifficulty): number {
  return QUIZ_DIFFICULTIES.indexOf(difficulty) + 1;
}

function reportDuplicates(context: z.RefinementCtx, values: readonly unknown[], path: readonly string[]): void {
  values.forEach((value, index) => {
    if (values.indexOf(value) !== index) {
      context.addIssue({ code: "custom", path: [...path, index], message: `${String(value)} is listed more than once` });
    }
  });
}

export const catalogSpotSchema = z
  .strictObject({
    config_id: configIdSchema.describe("A catalog configuration (GET /catalog/configs); checked to exist and be served"),
    hero_positions: z.array(positionSchema).min(1).max(MAX_POSITIONS).describe("The seats to practise; each seated at the configuration"),
    villain_positions: z
      .array(positionSchema)
      .max(MAX_POSITIONS)
      .optional()
      .describe("The opponents; absent or empty means any seat"),
    spot_types: z
      .array(z.enum(PREFLOP_ACTIONS))
      .min(1)
      .max(PREFLOP_ACTIONS.length)
      .describe("Preflop spot types, such as rfi (an open) or vs_open (facing an open)"),
  })
  .superRefine((spot, context) => {
    reportDuplicates(context, spot.hero_positions, ["hero_positions"]);
    reportDuplicates(context, spot.villain_positions ?? [], ["villain_positions"]);
    reportDuplicates(context, spot.spot_types, ["spot_types"]);
    (spot.villain_positions ?? []).forEach((seat, index) => {
      if (spot.hero_positions.includes(seat)) {
        context.addIssue({ code: "custom", path: ["villain_positions", index], message: `${seat} is also a hero seat` });
      }
    });
  })
  .meta({ id: "CatalogSpot", description: "A preflop spot from the catalog: configuration, seats and spot types (O-415)" });

export const quizOptionsSchema = z
  .strictObject({
    difficulty: z.enum(QUIZ_DIFFICULTIES).describe("easy, medium or hard: prediction levels 1, 2 and 3 (O-410)"),
    question_kinds: z
      .array(z.enum(QUIZ_QUESTION_KINDS))
      .min(1)
      .max(LADDER_COUNT)
      .describe("range asks about the whole range, hand about one hand class (O-411)"),
  })
  .superRefine((quiz, context) => reportDuplicates(context, quiz.question_kinds, ["question_kinds"]))
  .meta({ id: "QuizOptions" });

export type CatalogSpot = z.infer<typeof catalogSpotSchema>;
export type QuizOptions = z.infer<typeof quizOptionsSchema>;
