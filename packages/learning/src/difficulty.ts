/**
 * Item difficulty from solver features (A6 section 1 row "Item difficulty from features"; 06
 * section 3.2). Owner: S30 (p4/learning), closing R4.4: difficulty monotone in the EV (expected
 * value) gap between the best and second-best action and in purity, with distance to the
 * threshold card, reach probability, street, pot size and the cost of the most tempting wrong
 * action as the other features, weights set by hand in v1; items where every action is inside the
 * noise floor carry no information about skill and are excluded from rated play.
 *
 * No vector is pending here: R4.4's tests are monotonicity properties S30 writes against its own
 * weights, and the exclusion rule is covered by the rated-flag rows in test/R3.8-grading.test.ts.
 */
import type { ModulePlaceholder } from "./types.js";

export const DIFFICULTY_MODULE: ModulePlaceholder = Object.freeze({
  module: "difficulty",
  responsibility: "feature-based item difficulty and the rated-play exclusion of all-in-floor items",
  session: "S30",
  requirements: ["R4.4"],
});
