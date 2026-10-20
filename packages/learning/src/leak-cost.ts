/**
 * Leak cost and shrinkage (A6 section 1 row "Leak cost and shrinkage"; 06 section 6). Owner: S30
 * (p4/learning), closing R4.8.
 *
 * Rules the module will implement: leak_cost(spot_class) = frequency (spots per 1,000 hands)
 * x miss rate (share of decisions above the noise floor) x average EV (expected value) loss per
 * miss in big blinds (bb), giving bb lost per 1,000 hands. Frequency comes from the equilibrium
 * reach prior: seat rotation times the reach probability of the line under equilibrium play
 * (ADR 0013); personal frequency from hand capture replaces it in v2 through beta-binomial
 * shrinkage. Miss rate and EV per miss are shrunk toward the track average while a class has under
 * 30 decisions. The weekly leak_history write belongs to services/api (R4.11).
 *
 * Pending vectors: test/R4.8-leak-cost.test.ts.
 */
import type { ModulePlaceholder } from "./types.js";

export const LEAK_COST_MODULE: ModulePlaceholder = Object.freeze({
  module: "leak-cost",
  responsibility: "leak cost per spot class from the reach prior, with shrinkage under 30 decisions",
  session: "S30",
  requirements: ["R4.8"],
});
