/**
 * The holdout draw and the item replay (R4.13, O-100 refined by O-276, ADR 0013, ADR 0004).
 *
 * drawTrackItems draws one track's items from a stored seed, deterministically: a SplitMix64 stream
 * (learning's generator, the one solver-query runs) seeded with it picks, per try, a class of the
 * track weighted by its frequency prior (how often it arises, ADR 0013), one of the class's options
 * (configuration and pair) and one of its spots uniformly, and a deal seed. The deal at the spot's
 * line puts a hero hand at the class's decision; the hero's row there names the hand class. A try
 * is kept when (solution, node, hand class) is new to the draw and solver-query's difficulty
 * features say the item can be graded wrong (all_within_floor false: an item no action can miss
 * measures nothing). The draw stops at HOLDOUT_ITEMS_PER_TRACK items or after MAX_DRAW_TRIES tries;
 * a short draw is the caller's to discard (O-276). The same seed over the same library always draws
 * the same items, which is what storing the seed buys.
 *
 * replaysItem checks that an item's stored deal still yields its solution, node, hero seat and hand
 * class; a library change that breaks it makes the item unservable, so a holdout session skips it.
 */
import { createSplitMix64, type SplitMix64 } from "@g-tee-oh/learning";

import type { CatalogClass } from "../automated/class-catalog.js";
import type { TrackKey } from "../learning/tracks.js";
import { fromHex64, pickIndex, toHex64 } from "../sessions/randomness.js";
import type { SqClassSpot } from "../solver-query/client.js";
import type { DrawPort } from "./draw-port.js";
import type { HoldoutItem, NewHoldoutItem } from "./repository.js";

/** Items per track (06 section 9, O-276). */
export const HOLDOUT_ITEMS_PER_TRACK = 30;
/** Tries per wanted item before a draw gives up short. */
export const DRAW_TRIES_PER_ITEM = 40;
export const MAX_DRAW_TRIES = HOLDOUT_ITEMS_PER_TRACK * DRAW_TRIES_PER_ITEM;

interface Candidate {
  cls: CatalogClass;
  configId: string;
  pair: string;
  spot: SqClassSpot;
  dealSeed: string;
}

function itemKey(solutionId: string, nodeKey: string, hand: string): string {
  return `${solutionId}|${nodeKey}|${hand}`;
}

function pickClass(classes: readonly CatalogClass[], stream: SplitMix64): CatalogClass | undefined {
  const total = classes.reduce((sum, cls) => sum + cls.frequencyPriorPer1k, 0);
  const unit = stream.nextUnit();
  if (total <= 0) {
    return classes[Math.floor(unit * classes.length)];
  }
  let remaining = unit * total;
  for (const cls of classes) {
    remaining -= cls.frequencyPriorPer1k;
    if (remaining < 0) {
      return cls;
    }
  }
  return classes.at(-1);
}

function nextCandidate(classes: readonly CatalogClass[], stream: SplitMix64): Candidate | undefined {
  const cls = pickClass(classes, stream);
  const optionDraw = stream.nextU64();
  const spotDraw = stream.nextU64();
  const dealSeed = toHex64(stream.nextU64());
  const options = cls?.options ?? [];
  if (cls === undefined || options.length === 0) {
    return undefined;
  }
  const option = options[pickIndex(optionDraw, options.length)];
  if (option === undefined || option.spots.length === 0) {
    return undefined;
  }
  const spot = option.spots[pickIndex(spotDraw, option.spots.length)];
  return spot === undefined ? undefined : { cls, configId: option.configId, pair: option.pair, spot, dealSeed };
}

async function tryCandidate(candidate: Candidate, trackKey: TrackKey, port: DrawPort, seen: ReadonlySet<string>): Promise<NewHoldoutItem | undefined> {
  const { cls, spot } = candidate;
  const line = spot.line ?? null;
  const deal = await port.deal({ configId: candidate.configId, pair: candidate.pair, line }, candidate.dealSeed);
  const solutionId = deal.solution_ids[0];
  if (solutionId === undefined || deal.hero_position !== spot.hero_position) {
    return undefined;
  }
  const node = await port.heroNode(solutionId, deal.start_node_key, deal.hero_hand);
  const hand = node?.hands[0]?.hand;
  if (hand === undefined || seen.has(itemKey(solutionId, deal.start_node_key, hand))) {
    return undefined;
  }
  const grade = await port.grade(solutionId, deal.start_node_key, deal.hero_hand);
  if (grade.difficulty_features.all_within_floor) {
    return undefined;
  }
  return {
    trackKey,
    spotClassKey: cls.spotClassKey,
    configId: candidate.configId,
    pair: candidate.pair,
    line,
    heroPosition: deal.hero_position,
    dealSeed: candidate.dealSeed,
    solutionId,
    nodeKey: deal.start_node_key,
    hand,
  };
}

/** One track's items from `seed` (see the module doc); fewer than HOLDOUT_ITEMS_PER_TRACK when the tries ran out. */
export async function drawTrackItems(classes: readonly CatalogClass[], trackKey: TrackKey, seed: string, port: DrawPort): Promise<NewHoldoutItem[]> {
  const stream = createSplitMix64(fromHex64(seed));
  const items: NewHoldoutItem[] = [];
  const seen = new Set<string>();
  for (let tries = 0; tries < MAX_DRAW_TRIES && items.length < HOLDOUT_ITEMS_PER_TRACK; tries += 1) {
    const candidate = nextCandidate(classes, stream);
    if (candidate === undefined) {
      continue;
    }
    const item = await tryCandidate(candidate, trackKey, port, seen);
    if (item !== undefined) {
      seen.add(itemKey(item.solutionId, item.nodeKey, item.hand));
      items.push(item);
    }
  }
  return items;
}

/** True when the item's stored deal still yields its solution, node, hero seat and hand class. */
export async function replaysItem(item: HoldoutItem, port: DrawPort): Promise<boolean> {
  const deal = await port.deal({ configId: item.configId, pair: item.pair, line: item.line }, item.dealSeed);
  if (deal.solution_ids[0] !== item.solutionId || deal.start_node_key !== item.nodeKey || deal.hero_position !== item.heroPosition) {
    return false;
  }
  const node = await port.heroNode(item.solutionId, item.nodeKey, deal.hero_hand);
  return node?.hands[0]?.hand === item.hand;
}
