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
import { hex64Schema, sessionStateSchema } from "../schemas/training.js";
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

/**
 * The state of a prediction or range-painting session (S27, O-302): its kind, the number of prompts
 * answered (the next prompt is derived from the session seed and this counter, so GET next stays
 * pure and no strategy leaves the server before the answer), and mode-owned data that prediction/
 * and range-paint/ parse with their own schemas. Drill sessions have none.
 */
export const practiceKindSchema = z.enum(["prediction", "range_paint"]);
export const practiceStateSchema = z.strictObject({
  kind: practiceKindSchema,
  counter: z.number().int().min(0),
  data: z.record(z.string(), z.unknown()),
});

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
  /** Present only on prediction and range_paint sessions (S27, O-302). */
  practice: practiceStateSchema.optional(),
});

export type PracticeKind = z.infer<typeof practiceKindSchema>;
export type PracticeState = z.infer<typeof practiceStateSchema>;
export type HandEnd = z.infer<typeof handEndSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HeroSpot = z.infer<typeof heroSpotSchema>;
export type HandState = z.infer<typeof handStateSchema>;
export type PersistedState = z.infer<typeof persistedStateSchema>;

/**
 * The state of a new session: dealing hand 0 (A6 section 2). A prediction or range_paint session
 * starts awaiting its first prompt at counter 0 (O-302); the trainer machine never drives it.
 */
export function initialState(
  seed: string,
  spots: readonly HeroSpot[],
  spot: SessionSpot,
  practice?: PracticeKind,
): PersistedState {
  return persistedStateSchema.parse({
    phase: practice === undefined ? "dealing" : "await_hero",
    seed,
    hand_no: 0,
    spots: [...spots],
    spot,
    hand: null,
    previous_board: null,
    last_attempt_id: null,
    ...(practice === undefined ? {} : { practice: { kind: practice, counter: 0, data: {} } }),
  });
}
