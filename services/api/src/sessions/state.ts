/**
 * The persisted session state (R3.6, A6 section 2, A5 section 3): what practice_session.state holds
 * as jsonb, next to state_version. Only POST /sessions, POST /sessions/{id}/decisions and
 * POST /sessions/{id}/end write it; GET /sessions/{id}/next derives the next prompt from it and
 * writes nothing (derive.ts).
 *
 * Mechanism: the state names the session seed and the hand number, from which every deal and
 * draw is recomputed (randomness.ts); the hero spots POST /sessions found for the drill
 * (spot-search.ts), each a line to deal at and the hero seat that acts there, so a hand is dealt
 * straight at the hero's decision (deal-hand.ts); the drill's families, hands filter and
 * alternate_seats (spot.ts); and the facts of the hand in play once a decision was made in it: the
 * deal and the line it was posted with, the node the hand has reached, the history of actions, the
 * board, and both generator states (the opponent's for /v1/sample-action and the hero's roll
 * state). Every read parses the row with this schema, so a row that no longer matches fails loudly
 * as a 500 instead of driving a session from a malformed state. Seeds and generator states are
 * Hex64 strings (O-151).
 *
 * S31 (R4.10, R4.13, O-272, O-276) adds learning: null for a drill session (rows written before S31
 * parse, the default), the automated session's scope, queue state and current review block, or the
 * holdout session's round and serving order. An automated session reuses S23 dealing unchanged:
 * spots holds the current block's class spots and spot is { preflop_action: ["rfi"] (unused by
 * dealing), hands: all, alternate_seats: false }; a new block replaces spots. The TypeScript type
 * PersistedState is the schema's input, so learning may be absent where a state is built in code;
 * read it through learningOf.
 */
import { z } from "zod";

import { actionKindSchema } from "../schemas/study.js";
import {
  cardSchema,
  configIdSchema,
  lineSchema,
  nodeKeySchema,
  positionPairSchema,
  positionSchema,
  streetSchema,
  uuidSchema,
} from "../schemas/common.js";
import { hex64Schema, sessionStateSchema, trackKeySchema } from "../schemas/training.js";
import { sessionSpotSchema, type SessionSpot } from "./spot.js";

/** The most hero spots a session keeps; a drill over many pairs keeps the first ones found. */
export const MAX_HERO_SPOTS = 128;

/** Why the hand stops at its current node: a fold, the street closing, or a hand the solution never holds there. */
export const handEndSchema = z.enum(["fold", "street_closed", "off_range"]);

export const historyEntrySchema = z.strictObject({
  position: positionSchema,
  token: z.string(),
  label: z.string(),
});

/**
 * A hero decision the drill trains (spot-search.ts): the (configuration, pair), the preflop line
 * to deal at (null for the pair's root), the seat that acts there as the hero, and the actions of
 * the line as the prompt's history shows them.
 */
export const heroSpotSchema = z.strictObject({
  config_id: configIdSchema,
  pair: positionPairSchema,
  line: lineSchema.nullable(),
  hero_seat: positionSchema,
  history: z.array(historyEntrySchema),
});

export const handStateSchema = z.strictObject({
  config_id: configIdSchema,
  pair: positionPairSchema,
  /** The line the deal was posted with; a reveal posts the deal again with it. */
  line: lineSchema.nullable(),
  deal_seed: hex64Schema,
  deal_id: z.string().min(1),
  solution_id: uuidSchema,
  hero_position: positionSchema,
  villain_position: positionSchema,
  hero_hand: z.string().min(1),
  villain_hand: z.string().min(1),
  street: streetSchema,
  /** The node the hand has reached; null once an action ended the solution's line. */
  node_key: nodeKeySchema.nullable(),
  end: handEndSchema.nullable(),
  last_action_kind: actionKindSchema.nullable(),
  history: z.array(historyEntrySchema),
  board: z.array(cardSchema),
  opponent_rng_state: hex64Schema,
  roll_rng_state: hex64Schema,
});

/** The review block an automated session is serving (O-272). */
export const automatedBlockStateSchema = z.strictObject({
  spot_class_key: z.string().min(1),
  family: z.string().min(1),
  track_key: trackKeySchema.nullable(),
  worked_example: z.boolean(),
  served: z.number().int().min(0),
  size: z.number().int().min(1),
});

/** An automated session's learning state (R4.10, O-270 to O-274). */
export const automatedLearningSchema = z.strictObject({
  kind: z.literal("automated"),
  /** A client-supplied seed: every decision is unrated and no learning state is written (PM seed condition). */
  seeded: z.boolean(),
  config_ids: z.array(configIdSchema),
  /** How many class picks the session made; the pick stream's counter. */
  pick_no: z.number().int().min(0),
  /** learning's QueueState, as stored: the last family served and the confident misses to revisit (O-215). */
  queue: z.strictObject({ last_family: z.string().nullable(), hypercorrection: z.array(z.string()) }),
  block: automatedBlockStateSchema,
});

/** A holdout session's learning state (R4.13, O-276). */
export const holdoutLearningSchema = z.strictObject({
  kind: z.literal("holdout"),
  round_id: uuidSchema,
  /** The round's month (its first day), kept so the session view needs no read. */
  round_month: z.iso.date(),
  track_key: trackKeySchema.nullable(),
  /** holdout_item ids still to serve, in serving order. */
  remaining: z.array(uuidSchema),
  answered: z.number().int().min(0),
  total: z.number().int().min(0),
  current_item: uuidSchema.nullable(),
});

export const learningStateSchema = z.discriminatedUnion("kind", [automatedLearningSchema, holdoutLearningSchema]);

export const persistedStateSchema = z.strictObject({
  phase: sessionStateSchema,
  seed: hex64Schema,
  hand_no: z.number().int().min(0),
  spots: z.array(heroSpotSchema).min(1).max(MAX_HERO_SPOTS),
  /** The drill's families, hands filter and alternate_seats, copied at POST /sessions (spot.ts). */
  spot: sessionSpotSchema,
  hand: handStateSchema.nullable(),
  previous_board: z.array(cardSchema).nullable(),
  last_attempt_id: uuidSchema.nullable(),
  /** S31: null for drill sessions and rows written before S31. */
  learning: learningStateSchema.nullable().default(null),
});

export type HandEnd = z.infer<typeof handEndSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HeroSpot = z.infer<typeof heroSpotSchema>;
export type HandState = z.infer<typeof handStateSchema>;
/** The schema's input: learning may be absent in code-built states (read it with learningOf). */
export type PersistedState = z.input<typeof persistedStateSchema>;
export type AutomatedBlockState = z.infer<typeof automatedBlockStateSchema>;
export type AutomatedLearning = z.infer<typeof automatedLearningSchema>;
export type HoldoutLearning = z.infer<typeof holdoutLearningSchema>;
export type LearningState = z.infer<typeof learningStateSchema>;

/** The session's learning state; null for a drill session. */
export function learningOf(state: Pick<PersistedState, "learning">): LearningState | null {
  return state.learning ?? null;
}

/** The state of a new session: dealing hand 0 (A6 section 2). */
export function initialState(
  seed: string,
  spots: readonly HeroSpot[],
  spot: SessionSpot,
  learning: LearningState | null = null,
): PersistedState {
  return persistedStateSchema.parse({
    phase: "dealing",
    seed,
    hand_no: 0,
    spots: [...spots],
    spot,
    hand: null,
    previous_board: null,
    last_attempt_id: null,
    learning,
  });
}
