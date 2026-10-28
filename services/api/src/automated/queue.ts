/**
 * The automated queue (R4.10, A6 section 3, O-254, O-255, O-256, O-272): which spot class the next
 * review block serves. Pure: the inputs are the class catalog and the user's learning rows as read
 * (automated/repository.ts); every formula is learning's.
 *
 * Mechanism, per catalog class in scope:
 * - leak cost: the class's leak_stat leak_cost_bb_per_1k, or for a class with no leak_stat
 *   learning's startingLeakCost(frequency prior, the track's average over the user's classes in that
 *   track, null when the track has no decisions) (O-255);
 * - overdue factor: learning's overdueFactor(card, now, retention), the retention retentionFor(BKT
 *   mastered) (O-253, O-254); a class with no card is a first exposure with factor 1;
 * - priority: queuePriority(leak cost, overdue factor).
 * pickBlock runs learning's pickNext over those candidates with the pick stream's draw
 * (pick-stream.ts): the interleave rule, then a pending confident miss, then the priority draw
 * (O-256). The picked class becomes a block of REVIEW_BLOCK_INSTANCES hands over its spots
 * (O-272), a worked example when it is a first exposure.
 */
import {
  emptyQueueState,
  overdueFactor,
  pickNext,
  queuePriority,
  retentionFor,
  isMastered,
  startingLeakCost,
  type QueueCandidate,
  type QueueState,
  type SpotClassCard,
  type TrackAverage,
} from "@g-tee-oh/learning";

import type { TrackKey } from "../learning/tracks.js";
import type { AutomatedBlockState, AutomatedLearning, HeroSpot } from "../sessions/state.js";
import { heroSpotsOf, type CatalogClass, type ClassCatalog } from "./class-catalog.js";
import { pickRandomSource } from "./pick-stream.js";

/** Hands one review block serves, one decision each (O-272). */
export const REVIEW_BLOCK_INSTANCES = 3;

/** The user's learning rows the queue reads, keyed by spot_class_key (track averages by track). */
export type QueueInputs = Readonly<{
  cards: ReadonlyMap<string, SpotClassCard>;
  pKnown: ReadonlyMap<string, number>;
  leakCosts: ReadonlyMap<string, number>;
  trackAverages: ReadonlyMap<TrackKey, TrackAverage | null>;
}>;

export const EMPTY_QUEUE_INPUTS: QueueInputs = Object.freeze({
  cards: new Map(),
  pKnown: new Map(),
  leakCosts: new Map(),
  trackAverages: new Map(),
});

/** The leak cost a class's priority counts with (O-255). */
export function classLeakCost(cls: CatalogClass, inputs: QueueInputs): number {
  const stored = inputs.leakCosts.get(cls.spotClassKey);
  if (stored !== undefined) {
    return stored;
  }
  const track = cls.trackKey === null ? null : (inputs.trackAverages.get(cls.trackKey) ?? null);
  return startingLeakCost(cls.frequencyPriorPer1k, track);
}

/** The class's overdue factor at now, scheduled at the retention its mastery gives (O-253, O-254). */
export function classOverdueFactor(cls: CatalogClass, inputs: QueueInputs, now: Date): number {
  const card = inputs.cards.get(cls.spotClassKey) ?? null;
  const pKnown = inputs.pKnown.get(cls.spotClassKey);
  const mastered = pKnown === undefined ? false : isMastered({ pKnown });
  return overdueFactor(card, now, { requestRetention: retentionFor(mastered) });
}

/** One queue candidate per catalog class (see the module doc). */
export function queueCandidates(classes: readonly CatalogClass[], inputs: QueueInputs, now: Date): QueueCandidate[] {
  return classes.map((cls) => ({
    spotClassKey: cls.spotClassKey,
    family: cls.family,
    priority: queuePriority(classLeakCost(cls, inputs), classOverdueFactor(cls, inputs, now)),
    firstExposure: !inputs.cards.has(cls.spotClassKey),
  }));
}

/** A new session's queue state: no last family, no pending miss. */
export function emptyLearningQueue(): AutomatedLearning["queue"] {
  return fromQueueState(emptyQueueState());
}

export function toQueueState(queue: AutomatedLearning["queue"]): QueueState {
  return { lastFamily: queue.last_family, hypercorrection: [...queue.hypercorrection] };
}

export function fromQueueState(state: QueueState): AutomatedLearning["queue"] {
  return { last_family: state.lastFamily, hypercorrection: [...state.hypercorrection] };
}

export interface BlockPickInput {
  seed: string;
  /** Picks made so far: the pick stream's counter. */
  pickNo: number;
  queue: AutomatedLearning["queue"];
  candidates: readonly QueueCandidate[];
  catalog: ClassCatalog;
}

export interface BlockPick {
  block: AutomatedBlockState;
  queue: AutomatedLearning["queue"];
  pickNo: number;
  spots: HeroSpot[];
}

/** The next block: pickNext over the candidates with pick pickNo's draw (O-256, O-272). */
export function pickBlock(input: BlockPickInput): BlockPick {
  const step = pickNext(toQueueState(input.queue), input.candidates, pickRandomSource(input.seed, input.pickNo));
  const cls = input.catalog.byKey.get(step.pick.spotClassKey);
  if (cls === undefined) {
    throw new RangeError(`the picked class ${step.pick.spotClassKey} is not in the catalog`);
  }
  return {
    block: {
      spot_class_key: cls.spotClassKey,
      family: cls.family,
      track_key: cls.trackKey,
      worked_example: step.pick.firstExposure,
      served: 0,
      size: REVIEW_BLOCK_INSTANCES,
    },
    queue: fromQueueState(step.state),
    pickNo: input.pickNo + 1,
    spots: heroSpotsOf(cls),
  };
}
