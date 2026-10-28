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
 *
 * PR #27 review HIGH 2: seeded is true when POST /sessions took a client-supplied seed, in every
 * mode (false by default, so rows written before it parse). A seeded session writes no learning
 * state and its attempts never count toward leak stats, queue picks, /progress or the typical
 * response time (learning-state/repository.ts countedAttempts, shared-effects.ts); read it through
 * isSeededSession, which also honours the automated learning state's own seeded flag.
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
import { hex64Schema, previousHandSchema, sessionStateSchema, trackKeySchema } from "../schemas/training.js";
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
  /**
   * S31 (R4.13, O-276): a spot pinned to one stored deal. A holdout session's spot carries its
   * item's deal seed, and deal-hand.ts deals exactly that deal in a single attempt; absent for
   * drill and automated spots, which deal from the session seed as before.
   */
  deal_seed: hex64Schema.optional(),
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
  /**
   * How many history entries the hand was dealt with: its hero spot's line (S26, O-335). The
   * hero's decisions in the hand are the hero's entries after these, so a spot dealt facing a
   * 3-bet (whose line holds the hero's own open) starts at decision 1. Absent on rows written
   * before S26, which then count from the start of the history.
   */
  dealt_history_length: z.number().int().min(0).optional(),
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
  /**
   * learning's QueueState, as stored: the last family served. Rows written before S37 also hold
   * hypercorrection, the confident misses of the retired rule (O-215, O-345); it is read, dropped
   * and never written again (O-372).
   */
  queue: z
    .strictObject({ last_family: z.string().nullable(), hypercorrection: z.array(z.string()).optional() })
    .transform(({ last_family }) => ({ last_family })),
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
  /** How the last ended hand closed (S26, O-313); absent on rows written before S26 and before the first hand ends. */
  previous_hand: previousHandSchema.optional(),
  /** S31: null for drill and practice sessions and rows written before S31. */
  learning: learningStateSchema.nullable().default(null),
  /** PR #27 review HIGH 2: the session was created with a client-supplied seed (any mode). */
  seeded: z.boolean().default(false),
  /** Present only on prediction and range_paint sessions (S27, O-302). */
  practice: practiceStateSchema.optional(),
});

export type PracticeKind = z.infer<typeof practiceKindSchema>;
export type PracticeState = z.infer<typeof practiceStateSchema>;
export type HandEnd = z.infer<typeof handEndSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HeroSpot = z.infer<typeof heroSpotSchema>;
export type HandState = z.infer<typeof handStateSchema>;
export type PreviousHand = z.infer<typeof previousHandSchema>;
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

/** True when the session was created with a client-supplied seed (see the module doc). */
export function isSeededSession(state: Pick<PersistedState, "learning" | "seeded">): boolean {
  const learning = learningOf(state);
  return state.seeded === true || (learning?.kind === "automated" && learning.seeded);
}

/** What a new session's state carries beyond its seed and spots (each mode sets its own). */
export interface InitialStateExtras {
  /** S31: an automated or holdout session's learning state; null (the default) otherwise. */
  learning?: LearningState | null;
  /** PR #27 review HIGH 2: created with a client-supplied seed. */
  seeded?: boolean;
  /** S27 (O-302): a prediction or range_paint session's kind. */
  practice?: PracticeKind;
}

/**
 * The state of a new session: dealing hand 0 (A6 section 2); seeded per PR #27 review HIGH 2. A
 * prediction or range_paint session starts awaiting its first prompt at counter 0 (O-302); the
 * trainer machine never drives it.
 */
export function initialState(
  seed: string,
  spots: readonly HeroSpot[],
  spot: SessionSpot,
  extras: InitialStateExtras = {},
): PersistedState {
  return persistedStateSchema.parse({
    phase: extras.practice === undefined ? "dealing" : "await_hero",
    seed,
    hand_no: 0,
    spots: [...spots],
    spot,
    hand: null,
    previous_board: null,
    last_attempt_id: null,
    learning: extras.learning ?? null,
    seeded: extras.seeded ?? false,
    ...(extras.practice === undefined ? {} : { practice: { kind: extras.practice, counter: 0, data: {} } }),
  });
}
