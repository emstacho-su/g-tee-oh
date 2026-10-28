/**
 * Serving holdout items (R4.13, O-276, PR #27 review HIGH 1 and HIGH 4): the round's fixed serving
 * order, the hero spot that replays an item, and the search for the next item that still replays.
 *
 * Mechanism:
 * - Order (HIGH 1): an item's place in a round is the sha256 of the round's order seed and the item
 *   id, so the order is fixed per (user, round), the same for every session of the round, and an
 *   item keeps its place when a later draw adds another track's items. The seed is 64 random bits
 *   chosen when the round opens and never leaves the server, so no client can preview the order.
 * - Spot: an item replays at its stored line with its stored deal seed (HeroSpot.deal_seed, which
 *   deal-hand.ts deals in a single attempt), with the line's history as solver-query labelled it at
 *   the draw (holdout_item.history; ADR 0004). No class catalog is read.
 * - Servable (HIGH 4): an item whose stored deal still yields its solution, node, seat and hand class
 *   (draw.ts replaysItem). findServable walks the ordered items until one is servable. Only a
 *   deterministic failure makes an item unservable for the round (O-334): a replay that mismatches
 *   (another solution, node or seat, or the hand outside the node's range) or a 4xx from solver-query
 *   (draw-port.ts isDeterministicReplayFailure). A transient failure (its per-call deadline, a network
 *   error, a 5xx or 503) stops the search: that item and the ones after it stay untried (unresolved),
 *   as they do when the caller's budget runs out, so a later search tries them again. It runs before
 *   any transaction opens.
 */
import { createHash } from "node:crypto";

import { classLineEntry, heroSpotSchema, type HeroSpot } from "../sessions/state.js";
import { isDeterministicReplayFailure, type DrawPort } from "./draw-port.js";
import { replaysItem } from "./draw.js";
import type { HoldoutItem } from "./repository.js";

const ORDER_KEY_SEPARATOR = ":";

function orderKey(orderSeed: string, itemId: string): string {
  return createHash("sha256").update(`${orderSeed}${ORDER_KEY_SEPARATOR}${itemId}`).digest("hex");
}

/** The items in the round's serving order (see the module doc); a new array. */
export function roundOrder<T extends { id: string }>(items: readonly T[], orderSeed: string): T[] {
  return items
    .map((item) => ({ item, key: orderKey(orderSeed, item.id) }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.item.id.localeCompare(right.item.id))
    .map((entry) => entry.item);
}

/** The hero spot that replays the item exactly. */
export function itemSpot(item: HoldoutItem): HeroSpot {
  return heroSpotSchema.parse({
    config_id: item.configId,
    pair: item.pair,
    line: item.line,
    hero_seat: item.heroPosition,
    history: item.history.map(classLineEntry),
    deal_seed: item.dealSeed,
  });
}

export interface ServableItem {
  item: HoldoutItem;
  spot: HeroSpot;
  /** The items after it in serving order. */
  rest: HoldoutItem[];
}

/** What findServable found, in serving order. */
export interface ServingSearch {
  /** The first item that replays; undefined when none did (or the budget ran out first). */
  next: ServableItem | undefined;
  /** Items whose replay mismatched or failed deterministically: unservable for the round (O-334). */
  unservable: HoldoutItem[];
  /** Items a transient failure or the spent budget left untried: still unresolved (O-334). */
  untried: HoldoutItem[];
}

export interface SearchOptions {
  /** Fires when the search's whole budget is spent (the port's calls stop with it). */
  budget: AbortSignal;
  /** Called with each deterministic replay failure before the item is marked unservable. */
  onReplayError: (item: HoldoutItem, error: unknown) => void;
  /** Called with the transient replay failure that stops the search; the item stays unresolved (O-334). */
  onTransientError: (item: HoldoutItem, error: unknown) => void;
}

type Replay = "servable" | "unservable" | "untried";

async function tryReplay(item: HoldoutItem, port: DrawPort, options: SearchOptions): Promise<Replay> {
  if (options.budget.aborted) {
    return "untried";
  }
  try {
    return (await replaysItem(item, port)) ? "servable" : "unservable";
  } catch (error: unknown) {
    if (options.budget.aborted) {
      return "untried";
    }
    if (!isDeterministicReplayFailure(error)) {
      options.onTransientError(item, error);
      return "untried";
    }
    options.onReplayError(item, error);
    return "unservable";
  }
}

/** The first item of `ordered` that still replays, with the ones it found unservable (see the module doc). */
export async function findServable(ordered: readonly HoldoutItem[], port: DrawPort, options: SearchOptions): Promise<ServingSearch> {
  const unservable: HoldoutItem[] = [];
  for (const [index, item] of ordered.entries()) {
    const replay = await tryReplay(item, port, options);
    if (replay === "servable") {
      return { next: { item, spot: itemSpot(item), rest: ordered.slice(index + 1) }, unservable, untried: [] };
    }
    if (replay === "untried") {
      return { next: undefined, unservable, untried: ordered.slice(index) };
    }
    unservable.push(item);
  }
  return { next: undefined, unservable, untried: [] };
}
