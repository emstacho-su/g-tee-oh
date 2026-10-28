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
 * - afterInsert, drill and unseeded automated sessions only (holdout attempts change no learning
 *   state, O-274; a client-seeded automated session writes none, PM seed condition): the decided
 *   class's leak_stat is recomputed in the decision transaction (O-275, leak-stat.ts). A node
 *   without a class (outside the catalog) has no leak stat.
 * - The frequency prior is the class catalog's (Lane A's automated/class-catalog.ts, O-270) over the
 *   session's scope: the automated session's config_ids (every catalog configuration when empty), or
 *   the drill hand's configuration, so the prior is the one the automated queue sees for that scope.
 *   A class the catalog does not list keeps its stored prior, or 0 without one (O-270). A catalog
 *   that cannot load is logged at warn level and the stored prior is used: a ranking prior never
 *   fails a graded decision, and the next decision or the weekly job recomputes the row.
 */
import { itemDifficulty } from "@g-tee-oh/learning";

import { loadClassCatalog } from "../automated/class-catalog.js";
import { requireDatabase } from "../http/database.js";
import type { AfterInsertContext, DecisionContext, GradeOverrides, LearningHookPart } from "../learning/effects.js";
import { trackFor, type TrackKey } from "../learning/tracks.js";
import { learningOf } from "../sessions/state.js";
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

/** The configurations the session's catalog covers (see the module doc). */
function catalogScope(context: DecisionContext): readonly string[] | undefined {
  const learning = learningOf(context.session.state);
  if (learning?.kind === "automated") {
    return learning.config_ids.length === 0 ? undefined : learning.config_ids;
  }
  return [context.derived.hand.config_id];
}

/** The catalog's prior for the class, undefined when it is not listed or the catalog cannot load. */
export const catalogFrequencyPrior: FrequencyPriorSource = async (context, spotClassKey) => {
  try {
    // The catalog reads game_config outside the decision transaction, so a failed load cannot abort it.
    const catalog = await loadClassCatalog(context.solverQuery, requireDatabase(context.request.server), catalogScope(context));
    return catalog.byKey.get(spotClassKey)?.frequencyPriorPer1k;
  } catch (error: unknown) {
    context.request.log.warn({ err: error, spot_class_key: spotClassKey }, "class catalog unavailable; leak stat keeps its stored prior");
    return undefined;
  }
};

/** True when this session's decisions write learning rows (see the module doc). */
export function writesLearningState(context: Pick<DecisionContext, "session">): boolean {
  const learning = learningOf(context.session.state);
  if (learning === null) {
    return true;
  }
  return learning.kind === "automated" && !learning.seeded;
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
  const source = options.frequencyPrior ?? catalogFrequencyPrior;
  return {
    name: SHARED_EFFECTS_PART_NAME,
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
