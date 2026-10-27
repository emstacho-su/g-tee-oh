/**
 * Seat lists and canonical position pairs (R3.2, O-234, A3 section 1). This is naming data copied
 * from gto-model, not poker math (ADR 0004): which positions sit at each table size, and how a pair
 * of them is written.
 *
 * Mechanism: SEATED mirrors Position::seated in crates/gto-model/src/types.rs, seat by seat and in
 * the same order. A pair puts its out-of-position seat first by the postflop order (SB acts first,
 * BTN last; lower acts first, so it is out of position), as PositionPair::new does, which makes
 * every pair key canonical (BB-BTN, never BTN-BB). canonicalPairs takes every two seats with the
 * first seat earlier in the seated list, in that nested order, so its output equals what the Rust
 * side prints; test/seats.test.ts pins that output and fails on any drift.
 */
import type { POSITIONS } from "../schemas/common.js";

export type Position = (typeof POSITIONS)[number];

export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 9;

/** Position::postflop_order: lower acts first postflop, so it is the out-of-position seat. */
export const POSTFLOP_ORDER: Readonly<Record<Position, number>> = {
  SB: 0,
  BB: 1,
  UTG: 2,
  UTG1: 3,
  UTG2: 4,
  LJ: 5,
  HJ: 6,
  CO: 7,
  BTN: 8,
};

/** Position::seated, by table size. */
const SEATED: Readonly<Record<number, readonly Position[]>> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

export interface CanonicalPair {
  pair: string;
  oop: Position;
  ip: Position;
}

/** The positions seated at a table size, in gto-model's order; a size outside 2 to 9 throws. */
export function seatedPositions(tableSize: number): readonly Position[] {
  const seats = Number.isInteger(tableSize) ? SEATED[tableSize] : undefined;
  if (seats === undefined) {
    throw new RangeError(`table size ${tableSize} is outside ${MIN_TABLE_SIZE} to ${MAX_TABLE_SIZE}`);
  }
  return seats;
}

/** One pair of two different seats, out-of-position seat first (PositionPair::new). */
export function canonicalPair(first: Position, second: Position): CanonicalPair {
  const firstIsOop = POSTFLOP_ORDER[first] < POSTFLOP_ORDER[second];
  const oop = firstIsOop ? first : second;
  const ip = firstIsOop ? second : first;
  return { pair: `${oop}-${ip}`, oop, ip };
}

/** Every pair of two seats at a table size, in the order gto-model enumerates them. */
export function canonicalPairs(tableSize: number): readonly CanonicalPair[] {
  const seats = seatedPositions(tableSize);
  return seats.flatMap((first, index) => seats.slice(index + 1).map((second) => canonicalPair(first, second)));
}
