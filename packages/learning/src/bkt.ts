/**
 * BKT (Bayesian Knowledge Tracing) mastery per spot class (A6 section 1 row "BKT mastery"; 06
 * section 5; ADR 0012). Owner: S30 (p4/learning), closing R4.7.
 *
 * Rules the module will implement: starting parameters prior 0.2, learn 0.15, guess 0.2, slip
 * 0.1 (tuned once data exists); after each instance the posterior given the evidence is followed
 * by the learn transition; mastered means p of 0.95 or more; mastery drives the heat map and lets
 * FSRS space mastered classes further apart; it gates nothing and locks no content.
 *
 * Pending vectors (hand-computed posteriors): test/R4.7-bkt.test.ts.
 */
import type { ModulePlaceholder } from "./types.js";

export const BKT_MODULE: ModulePlaceholder = Object.freeze({
  module: "bkt",
  responsibility: "BKT mastery probability per spot class, mastered at 0.95, gating nothing",
  session: "S30",
  requirements: ["R4.7"],
});
