/**
 * Serving holdout items in a session (R4.13, O-276): the seeded serving order, the hero spot that
 * replays an item, and the next item that still replays.
 *
 * Mechanism:
 * - Order: a Fisher-Yates shuffle of the round's unanswered items driven by a SplitMix64 stream from
 *   the session seed XOR ORDER_STREAM_SALT (so the order and the hands' own draws never share a
 *   stream). The seed is always 64 random bits (the PM seed condition), so no client can preview it.
 * - Spot: an item replays at its stored line with its stored deal seed (HeroSpot.deal_seed, which
 *   deal-hand.ts deals in a single attempt). The line's history, as the prompt shows it, is the
 *   catalog's ClassSpot.history for that line (solver-query labels it; ADR 0004); an item whose class
 *   or line the catalog no longer lists has no spot.
 * - Servable: an item with a spot whose stored deal still yields its solution, node, seat and hand
 *   class (draw.ts replaysItem). An item that is not servable is skipped for the session; it stays
 *   unanswered in the round.
 */
import { createSplitMix64 } from "@g-tee-oh/learning";

import type { ClassCatalog } from "../automated/class-catalog.js";
import { fromHex64, pickIndex } from "../sessions/randomness.js";
import { heroSpotSchema, type HeroSpot } from "../sessions/state.js";
import type { DrawPort } from "./draw-port.js";
import { replaysItem } from "./draw.js";
import type { HoldoutItem } from "./repository.js";

/** Separates the serving-order stream from the session's hand draws (any fixed 64-bit value). */
export const ORDER_STREAM_SALT = 0x686f_6c64_6f75_7431n;

/** The items in the session's serving order. */
export function servingOrder<T>(items: readonly T[], seed: string): T[] {
  const stream = createSplitMix64(fromHex64(seed) ^ ORDER_STREAM_SALT);
  const order = [...items];
  for (let last = order.length - 1; last > 0; last -= 1) {
    const swap = pickIndex(stream.nextU64(), last + 1);
    const held = order[last] as T;
    order[last] = order[swap] as T;
    order[swap] = held;
  }
  return order;
}

/** The hero spot that replays the item, or undefined when the catalog no longer lists its line. */
export function itemSpot(item: HoldoutItem, catalog: ClassCatalog): HeroSpot | undefined {
  const option = catalog.byKey
    .get(item.spotClassKey)
    ?.options.find((candidate) => candidate.configId === item.configId && candidate.pair === item.pair);
  const spot = option?.spots.find((candidate) => (candidate.line ?? null) === item.line && candidate.hero_position === item.heroPosition);
  if (spot === undefined) {
    return undefined;
  }
  return heroSpotSchema.parse({
    config_id: item.configId,
    pair: item.pair,
    line: item.line,
    hero_seat: item.heroPosition,
    history: spot.history.map((entry) => ({ position: entry.position, token: entry.token, label: entry.label })),
    deal_seed: item.dealSeed,
  });
}

export interface ServableItem {
  item: HoldoutItem;
  spot: HeroSpot;
  /** The items after it in serving order. */
  rest: HoldoutItem[];
}

/** The first item of `ordered` that still replays, with the ones after it; undefined when none does. */
export async function firstServable(ordered: readonly HoldoutItem[], catalog: ClassCatalog, port: DrawPort): Promise<ServableItem | undefined> {
  for (const [index, item] of ordered.entries()) {
    const spot = itemSpot(item, catalog);
    if (spot !== undefined && (await replaysItem(item, port))) {
      return { item, spot, rest: ordered.slice(index + 1) };
    }
  }
  return undefined;
}
