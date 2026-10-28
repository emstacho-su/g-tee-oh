/**
 * The production learning hooks (R4.10, R4.11, R4.13, R4.14): the lanes' LearningHookParts in the
 * order they must run (learning/effects.ts explains why order matters). Each lane adds its one part
 * here when it lands:
 * 1. Lane B, the shared effects every mode runs: track_ids, item_difficulty, leak_stat, the block
 *    close's schedule card and mastery, the session-end rating (learning-state/*).
 * 2. Lane A, the automated loop: mode automated, first attempt by item, the per-track daily cap,
 *    panels by block, the queue state, block advance and next pick (automated/*).
 * 3. Lane C, holdout results, streaks and unlocks, and the holdout guard loader (holdout/*,
 *    streaks/*).
 * buildApp decorates the app with DEFAULT_LEARNING_HOOKS unless BuildAppOptions.learningHooks
 * injects others (a test that injects a failing part, for example).
 */
import "fastify";

import { AUTOMATED_HOOK_PART } from "../automated/effects.js";
import { HOLDOUT_HOOK_PART } from "../holdout/effects.js";
import { SHARED_EFFECTS_PART } from "../learning-state/shared-effects.js";
import { composeLearningHooks, type LearningHookPart, type LearningHooks } from "./effects.js";

declare module "fastify" {
  interface FastifyInstance {
    learningHooks: LearningHooks;
  }
}

export const LEARNING_HOOK_PARTS: readonly LearningHookPart[] = [
  SHARED_EFFECTS_PART,
  AUTOMATED_HOOK_PART,
  HOLDOUT_HOOK_PART,
];

export const DEFAULT_LEARNING_HOOKS: LearningHooks = composeLearningHooks(LEARNING_HOOK_PARTS);
