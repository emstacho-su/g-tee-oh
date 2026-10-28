/**
 * Shared value schemas for the api contract (R3.1). The identifier grammars match the ones the
 * library manifest schema already fixes (packages/contracts/schemas/manifest.schema.json, O-112,
 * O-132), so a configuration id or a position pair means the same thing on both sides of the
 * api and solver-query.
 */
import { z } from "zod";

export const CONFIG_ID_PATTERN = /^cfg_[2-9]_(online|live)(_[a-z0-9]+)?_[0-9]+(cbb)?(_straddle)?(_ante[0-9]+)?$/;
export const POSITION_PAIR_PATTERN =
  /^(UTG|UTG1|UTG2|LJ|HJ|CO|BTN|SB|BB)-(UTG|UTG1|UTG2|LJ|HJ|CO|BTN|SB|BB)$/;
export const LINE_PATTERN = /^[a-z][0-9]*(\.[a-z][0-9]*)*$/;
export const CARD_PATTERN = /^[2-9TJQKA][cdhs]$/;
export const BOARD_PATTERN = /^([2-9TJQKA][cdhs]){3,5}$/;
export const FLOP_PATTERN = /^([2-9TJQKA][cdhs]){3}$/;
/** A starting hand class (AA, AKs, T9o) or two exact cards (AhKd). */
export const HAND_PATTERN = /^(([2-9TJQKA])\2|[2-9TJQKA]{2}[so]|[2-9TJQKA][cdhs][2-9TJQKA][cdhs])$/;
export const HAND_CLASS_PATTERN = /^(([2-9TJQKA])\2|[2-9TJQKA]{2}[so])$/;

export const MAX_NODE_KEY_LENGTH = 512;

export const POSITIONS = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;

export const uuidSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true }).describe("RFC 3339 timestamp");
export const gameFormatSchema = z.enum(["online", "live"]);
export const configIdSchema = z
  .string()
  .regex(CONFIG_ID_PATTERN)
  .describe("A game_config identifier, for example cfg_9_live_13_150");
export const positionSchema = z.enum(POSITIONS);
export const positionPairSchema = z
  .string()
  .regex(POSITION_PAIR_PATTERN)
  .describe("Two positions, out of position first, for example BB-BTN");
export const lineSchema = z
  .string()
  .regex(LINE_PATTERN)
  .describe("A preflop line as dot-separated action tokens, for example r250.c");
export const cardSchema = z.string().regex(CARD_PATTERN);
export const boardSchema = z.string().regex(BOARD_PATTERN).describe("Three to five cards, for example KhQd4s");
export const flopSchema = z.string().regex(FLOP_PATTERN).describe("Three cards, for example KhQd4s");
export const handSchema = z.string().regex(HAND_PATTERN).describe("A hand class (AKs) or two cards (AhKd)");
export const handClassSchema = z.string().regex(HAND_CLASS_PATTERN).describe("A hand class, for example AKs");
export const nodeKeySchema = z.string().min(1).max(MAX_NODE_KEY_LENGTH).describe("An opaque node key");
export const streetSchema = z.enum(["preflop", "flop", "turn", "river"]);
export const tableSizeSchema = z.number().int().min(2).max(9);

export const idParamsSchema = z.object({ id: uuidSchema });
export const configIdParamsSchema = z.object({ id: configIdSchema });
/** Session routes take the same uuid id parameter as every other resource. */
export const sessionParamsSchema = idParamsSchema;

/**
 * The body of a mutating route that takes none. Fastify validates a request with no body as null,
 * so the schema accepts null as well as an absent or empty JSON object (PR #25 review LOW 12).
 */
export const emptyBodySchema = z.strictObject({}).nullable().optional();
