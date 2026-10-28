/**
 * The shared decision effects every session mode runs (R4.11, O-270, O-271, O-274, O-275): Lane B's
 * LearningHookPart, first in learning/hooks.ts, so the automated part after it reads its writes.
 *
 * Mechanism:
 * - beforeGrade, every mode (O-274: every attempt carries its track ids and item difficulty):
 *   track_ids is the one track of the node's class (tracks.ts trackFor over solver-query's
 *   action_family and the hero's seat; empty for a family no track takes); item_difficulty is
 *   learning's itemDifficulty over the grade's difficulty_features, and an all-within-floor item
 *   sets itemExcluded, which decide.ts's post-grade step turns into learning's withItemExclusion
 *   (unrated).
 * - afterInsert, drill and automated sessions not created with a client seed only (holdout attempts
 *   change no learning state, O-274; a client-seeded session of any mode writes none, PM seed
 *   condition, PR #27 review HIGH 2, sessions/state.ts isSeededSession): the decided
 *   class's leak_stat is recomputed in the decision transaction (O-275, leak-stat.ts). A node
 *   without a class (outside the catalog) has no leak stat.
 * - The frequency prior is the all-configs class catalog's (Lane A's automated/class-catalog.ts,
 *   O-270), the one the decision's prepare phase loaded before the transaction opened
 *   (context.prepared.catalog, learning/prepare.ts, PR #27 review HIGH 3 and MEDIUM 12), so a
 *   (user, class) row gets the same prior whichever session wrote it (the PM's choice), and the
 *   decision path never loads the catalog itself. A class the catalog does not list, or a decision
 *   whose catalog could not load (prepared.catalog null), keeps its stored prior, or 0 without one
 *   (O-270): a ranking prior never fails a graded decision, and the next decision or the weekly
 *   job recomputes the row.
 * - Track ids come from the cached track map (repository.ts, PR #27 review LOW 15), so beforeGrade
 *   reads nothing and afterInsert's recompute is two statements (leak-stat.ts).
 */
import { itemDifficulty } from "@g-tee-oh/learning";

import type { AfterInsertContext, DecisionContext, GradeOverrides, LearningHookPart } from "../learning/effects.js";
import { trackFor, type TrackKey } from "../learning/tracks.js";
import { isSeededSession, learningOf } from "../sessions/state.js";
import { recomputeLeakStat, storedFrequencyPrior } from "./leak-stat.js";
import { trackIdOf } from "./repository.js";

export const SHARED_EFFECTS_PART_NAME = "shared-effects";

/** A class's prior without a catalog entry or a stored row (O-270). */
const NO_PRIOR_PER_1K = 0;

/** Where the frequency prior of the decided class comes from (the catalog in production). */
export type FrequencyPriorSource = (context: DecisionContext, spotClassKey: string) => Promise<number | undefined>;

export interface SharedEffectsOptions {
  frequencyPrior?: FrequencyPriorSource;
}

function trackKeyOf(context: DecisionContext): TrackKey | null {
  return trackFor(context.derived.node.action_family ?? null, context.derived.hand.hero_position);
}

/** The prepared catalog's prior for the class; undefined when it is not listed or no catalog loaded. */
export const preparedCatalogPrior: FrequencyPriorSource = (context, spotClassKey) =>
  Promise.resolve(context.prepared.catalog?.byKey.get(spotClassKey)?.frequencyPriorPer1k);

/** True when this session's decisions write learning rows (see the module doc). */
export function writesLearningState(context: Pick<DecisionContext, "session">): boolean {
  if (isSeededSession(context.session.state)) {
    return false;
  }
  const learning = learningOf(context.session.state);
  return learning === null || learning.kind === "automated";
}

async function beforeGrade(context: DecisionContext): Promise<GradeOverrides> {
  const trackKey = trackKeyOf(context);
  const features = context.grade.difficulty_features;
  const item = itemDifficulty({
    evGapPctPot: features.ev_gap_pct_pot,
    purity: features.purity,
    allWithinFloor: features.all_within_floor,
  });
  return {
    trackIds: trackKey === null ? [] : [await trackIdOf(context.transaction, trackKey)],
    itemDifficulty: item.difficulty,
    ...(item.excluded ? { itemExcluded: true } : {}),
  };
}

async function priorOf(context: DecisionContext, spotClassKey: string, source: FrequencyPriorSource): Promise<number> {
  const fromSource = await source(context, spotClassKey);
  if (fromSource !== undefined) {
    return fromSource;
  }
  return (await storedFrequencyPrior(context.transaction, context.userId, spotClassKey)) ?? NO_PRIOR_PER_1K;
}

/** The shared effects part; tests may inject the prior source. */
export function createSharedEffectsPart(options: SharedEffectsOptions = {}): LearningHookPart {
  const source = options.frequencyPrior ?? preparedCatalogPrior;
  return {
    name: SHARED_EFFECTS_PART_NAME,
    // The leak stat prior reads the all-configs catalog the prepare phase loads (see the module doc).
    needsCatalog: true,
    beforeGrade,
    async afterInsert(context: AfterInsertContext) {
      const spotClassKey = context.derived.node.spot_class_key ?? null;
      if (!writesLearningState(context) || spotClassKey === null) {
        return {};
      }
      await recomputeLeakStat(context.transaction, {
        userId: context.userId,
        spotClassKey,
        trackKey: trackKeyOf(context),
        frequencyPriorPer1k: await priorOf(context, spotClassKey, source),
        now: context.now,
      });
      return {};
    },
  };
}

/** The production part, registered first in learning/hooks.ts. */
export const SHARED_EFFECTS_PART: LearningHookPart = createSharedEffectsPart();
