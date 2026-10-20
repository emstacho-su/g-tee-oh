/**
 * Glicko-2 rating per track with fractional outcomes (A6 section 1 row "Glicko-2 per track
 * (fractional outcomes)"; 06 section 3.3). Owner: S30 (p4/learning), closing R4.1 (the update,
 * proven by Glickman's worked example), R4.2 (the simulated learner within 25 rating points after
 * 300 items, O-65), R4.3 (anti-farming) and R4.5 (overall rank and tiers).
 *
 * Parameters per ADR 0011, accepted at sprint start (O-56): new track at rating 1500, rating
 * deviation (RD) 350, volatility 0.06; system constant tau 0.5; one rating period per session
 * (O-27); inactivity raises RD and never subtracts points; ranking uses rating minus two RD; the
 * RD cap for promotion is 120 and the daily rated cap per track is 150. The outcome of a decision
 * is its score in [0, 1] from the grading policy (05 section 6.3), an extension of the paper's
 * 0, 0.5 and 1 that R4.2 verifies by simulation (risk R-7).
 *
 * Pending vectors: test/R4.1-glicko2.test.ts.
 */
import type { ModulePlaceholder } from "./types.js";

export const GLICKO2_MODULE: ModulePlaceholder = Object.freeze({
  module: "glicko2",
  responsibility: "Glicko-2 rating per track with fractional outcomes and one period per session",
  session: "S30",
  requirements: ["R4.1", "R4.2", "R4.3", "R4.5"],
});
