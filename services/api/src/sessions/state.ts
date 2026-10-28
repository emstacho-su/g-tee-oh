/**
 * The persisted session state (R3.6, A6 section 2, A5 section 3): what practice_session.state holds
 * as jsonb, next to state_version. Only POST /sessions, POST /sessions/{id}/decisions and
 * POST /sessions/{id}/end write it; GET /sessions/{id}/next derives the next prompt from it and
 * writes nothing (derive.ts).
 *
 * Mechanism: the state names the session seed and the hand number, from which every deal and
 * draw is recomputed (randomness.ts), plus the facts of the hand in play once a decision was made
 * in it: the deal, the node the hand has reached, the history of actions, the board, and both
 * generator states (the opponent's for /v1/sample-action and the hero's roll state). Every read
 * parses the row with this schema, so a row that no longer matches fails loudly as a 500 instead
 * of driving a session from a malformed state. Seeds and generator states are Hex64 strings
 * (O-151).
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

/** Why the hand stops at its current node: a fold, the street closing, or a hand the solution never holds there. */
export const handEndSchema = z.enum(["fold", "street_closed", "off_range"]);

export const historyEntrySchema = z.strictObject({
  position: positionSchema,
  token: z.string(),
  label: z.string(),
});

/**
 * A spot the session deals: a covered (configuration, pair) and the pair's seats the drill can put
 * the hero in, in pair order (out of position first), as POST /sessions found them (spot-search.ts).
 */
export const candidateSchema = z.strictObject({
  config_id: configIdSchema,
  pair: positionPairSchema,
  hero_seats: z.array(positionSchema).min(1),
});

export const handStateSchema = z.strictObject({
  config_id: configIdSchema,
  pair: positionPairSchema,
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

export const persistedStateSchema = z.strictObject({
  phase: sessionStateSchema,
  seed: hex64Schema,
  hand_no: z.number().int().min(0),
  candidates: z.array(candidateSchema).min(1),
  line: lineSchema.nullable(),
  /** The drill's families, hands filter and alternate_seats, copied at POST /sessions (spot.ts). */
  spot: sessionSpotSchema,
  hand: handStateSchema.nullable(),
  previous_board: z.array(cardSchema).nullable(),
  last_attempt_id: uuidSchema.nullable(),
});

export type HandEnd = z.infer<typeof handEndSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type HandState = z.infer<typeof handStateSchema>;
export type PersistedState = z.infer<typeof persistedStateSchema>;

/** The state of a new session: dealing hand 0 (A6 section 2). */
export function initialState(seed: string, candidates: readonly Candidate[], line: string | null, spot: SessionSpot): PersistedState {
  return persistedStateSchema.parse({
    phase: "dealing",
    seed,
    hand_no: 0,
    candidates: [...candidates],
    line,
    spot,
    hand: null,
    previous_board: null,
    last_attempt_id: null,
  });
}
