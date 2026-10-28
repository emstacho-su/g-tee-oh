/**
 * The part of a drill's spot filter a session keeps and plays by (R3.6, 05 section 4, ADR 0004,
 * O-249): the preflop action families, the hands filter and alternate_seats. It is copied into the
 * session state at POST /sessions, so editing the drill later does not change a running session.
 * The hero positions live in the hero spots instead (spot-search.ts), and pickSpot draws a hand's
 * spot from them.
 *
 * The hands filter:
 * - all: every dealt hand;
 * - manual: the hero's hand class is in the list, compared in canonical rank order (hand-class.ts);
 * - close_decisions: the hero's row, as solver-query answers it at the hero's node, is close: at
 *   least two actions played at CLOSE_MIX_MIN_FREQUENCY or more (a mixed strategy), or at least two
 *   actions losing at most CLOSE_LOSS_MAX_PCT_POT percent of the pot (the best loses 0, so a second
 *   action is nearly as good). Both compare solver-query's own numbers with a named threshold;
 *   nothing is computed (ADR 0004).
 */
import { z } from "zod";

import { handsFilterSchema, PREFLOP_ACTIONS, type SpotFilter } from "../schemas/drills.js";
import type { SqSchemas } from "../solver-query/client.js";
import { canonicalClass, comboClass } from "./hand-class.js";
import type { HeroSpot } from "./state.js";

/** An action played at least this often makes the row mixed (a share of 1). */
export const CLOSE_MIX_MIN_FREQUENCY = 0.1;
/** A second action losing at most this much, in percent of the pot, makes the row close. */
export const CLOSE_LOSS_MAX_PCT_POT = 2;
/** Actions that must clear a threshold for a row to be close: the best and one more. */
const CLOSE_ACTIONS = 2;
/** alternate_seats needs both of the pair's seats playable. */
const SEATS_TO_ALTERNATE = 2;
const PAIR_SEPARATOR = "-";

export const sessionSpotSchema = z.strictObject({
  preflop_action: z.array(z.enum(PREFLOP_ACTIONS)).min(1),
  hands: handsFilterSchema,
  alternate_seats: z.boolean(),
});

export type SessionSpot = z.infer<typeof sessionSpotSchema>;
export type HandsFilter = SessionSpot["hands"];
export type HandRow = SqSchemas["HandRow"];

/** The session's copy of the drill's spot. */
export function spotOf(filter: Pick<SpotFilter, "preflop_action" | "hands" | "alternate_seats">): SessionSpot {
  return sessionSpotSchema.parse({ preflop_action: filter.preflop_action, hands: filter.hands, alternate_seats: filter.alternate_seats });
}

function pairOf(spot: HeroSpot): string {
  return `${spot.config_id}/${spot.pair}`;
}

/** The pair's seats that have a hero spot, out of position first (the pair's own order). */
function heroSeatsOf(spots: readonly HeroSpot[]): string[] {
  const seats = spots[0]?.pair.split(PAIR_SEPARATOR) ?? [];
  return seats.filter((seat) => spots.some((spot) => spot.hero_seat === seat));
}

/**
 * The hero spot of hand `handNo`, from its 64-bit pick draw: the draw picks a (configuration, pair)
 * first (pick modulo the pairs, in the order the spots were found), then one of its spots (the rest
 * of the draw modulo those spots). With alternate_seats and both of the pair's seats playable, only
 * the spots of seat handNo modulo 2 are drawn from, so the hero alternates hand by hand.
 */
export function pickSpot(spots: readonly HeroSpot[], spot: SessionSpot, handNo: number, pick: bigint): HeroSpot {
  const pairs = [...new Set(spots.map(pairOf))];
  if (pairs.length === 0) {
    throw new RangeError("a session needs at least one hero spot");
  }
  const count = BigInt(pairs.length);
  const ofPair = spots.filter((candidate) => pairOf(candidate) === pairs[Number(pick % count)]);
  const seats = heroSeatsOf(ofPair);
  const alternating = spot.alternate_seats && seats.length >= SEATS_TO_ALTERNATE;
  const pool = alternating ? ofPair.filter((candidate) => candidate.hero_seat === seats[handNo % seats.length]) : ofPair;
  const chosen = pool[Number((pick / count) % BigInt(pool.length))];
  if (chosen === undefined) {
    throw new RangeError("no hero spot to pick");
  }
  return chosen;
}

export function isCloseRow(row: Pick<HandRow, "strategy" | "loss_pct_pot">): boolean {
  const mixed = row.strategy.filter((frequency) => frequency >= CLOSE_MIX_MIN_FREQUENCY).length >= CLOSE_ACTIONS;
  const cheap = row.loss_pct_pot.filter((loss) => loss <= CLOSE_LOSS_MAX_PCT_POT).length >= CLOSE_ACTIONS;
  return mixed || cheap;
}

function inManualList(hands: readonly string[], handClass: string): boolean {
  return hands.some((listed) => canonicalClass(listed) === handClass);
}

/** True when the hero's row at the hero's node passes the hands filter. */
export function rowPasses(filter: HandsFilter, row: HandRow): boolean {
  if (filter.mode === "all") {
    return true;
  }
  if (filter.mode === "manual") {
    return inManualList(filter.hands, canonicalClass(row.hand));
  }
  return isCloseRow(row);
}

/**
 * False only when the combo can never pass: a manual list without its class. Checked straight
 * after the deal, so a narrow list is dealt again with that one call and no node read.
 */
export function comboMayPass(filter: HandsFilter, combo: string): boolean {
  return filter.mode !== "manual" || inManualList(filter.hands, comboClass(combo));
}

/** True when some row of a node passes the filter (POST /sessions' satisfiability check). */
export function anyRowPasses(filter: HandsFilter, rows: readonly HandRow[]): boolean {
  return rows.some((row) => rowPasses(filter, row));
}
