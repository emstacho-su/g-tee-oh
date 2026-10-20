/**
 * @g-tee-oh/learning holds the pure TypeScript learning model. S05 lands the red test vectors
 * and the skeleton types, S22 the grading policy, and S30 the Glicko-2 rating, FSRS (Free Spaced
 * Repetition Scheduler) scheduling, BKT (Bayesian Knowledge Tracing) mastery and leak-cost
 * modules. This package stays pure: no I/O (input/output), no clock, no randomness except an
 * injected random number generator (A1 section 2), so every module is testable with fixed
 * vectors. It depends on no other workspace package. Until S05 this module only names the
 * package (R0.1).
 */
export const PACKAGE_NAME = "@g-tee-oh/learning" as const;
