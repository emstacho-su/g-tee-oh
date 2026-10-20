/**
 * FSRS (Free Spaced Repetition Scheduler) adapter over ts-fsrs (A6 section 1 row "FSRS
 * scheduling"; 06 section 4; ADR 0012). Owner: S30 (p4/learning), closing R4.6.
 *
 * Rules the adapter will implement: one card per spot class; the review grade comes from the mean
 * score over the instances served in that review and the median response time (Again under 0.4,
 * Hard 0.4 to 0.7, Good 0.7 to 0.95, Easy at 0.95 or more when faster than the class's typical
 * time); desired retention 0.9; default parameters until enough reviews exist for fitting.
 *
 * License (O-35, ADR 0002): ts-fsrs 5.4.2 is MIT licensed; node_modules/ts-fsrs/LICENSE reads
 * "MIT License, Copyright (c) 2026 Open Spaced Repetition". Its published vectors are encoded in
 * test/R4.6-fsrs.test.ts with their source file and commit.
 *
 * Purity: ts-fsrs takes the review time as an argument (repeat(card, now) and next(card, now,
 * grade)), so the adapter passes the time it is given and never reads a clock (A1 section 2).
 */
import type { ModulePlaceholder } from "./types.js";

export const FSRS_MODULE: ModulePlaceholder = Object.freeze({
  module: "fsrs",
  responsibility: "FSRS scheduling per spot class over ts-fsrs, with the grade mapping from mean score",
  session: "S30",
  requirements: ["R4.6"],
});
