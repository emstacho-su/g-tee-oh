import { describe, expect, it } from "vitest";

import * as learning from "../src/index.js";
import { PACKAGE_NAME } from "../src/index.js";

/** The functions S22 lands for services/api (S23), web (S25) and the learning core (S30). */
const S22_FUNCTIONS = [
  "grade",
  "scoreFor",
  "isRated",
  "groupKeys",
  "rngBands",
  "actionForRoll",
  "rollFrom",
  "rollSelectedAction",
  "passiveToAggressiveOrder",
  "chiSquareStatistic",
  "createSplitMix64",
  "splitMix64Source",
  "splitMix64Step",
  "isCorrectLabel",
  "bestActionIndexes",
  "followsRoll",
  "lowestLossIndexes",
] as const;

/**
 * The functions S30 lands for services/api (S31), per A6 section 1 row, with the R IDs each row
 * closes: Glicko-2 and the session period (R4.1, R4.2, R4.3), item difficulty (R4.4), overall rank
 * and tiers (R4.5), FSRS (R4.6), BKT (R4.7), leak cost (R4.8) and queue selection (R4.9).
 */
const S30_FUNCTIONS = [
  "newTrackRating",
  "ratePeriod",
  "rateSession",
  "applyInactivity",
  "inactivePeriods",
  "conservativeRating",
  "itemDifficulty",
  "withItemExclusion",
  "trackWeight",
  "overallRating",
  "bandTier",
  "tierFor",
  "gradeFromMean",
  "reviewGrade",
  "newSpotClassCard",
  "reviewSpotClass",
  "reviewInDeck",
  "memoryState",
  "retrievability",
  "retentionFor",
  "isDue",
  "overdueFactor",
  "newMastery",
  "updateMastery",
  "observationFromLabel",
  "isMastered",
  "frequencyPriorPer1000",
  "classStat",
  "trackAverage",
  "shrinkTowardTrack",
  "leakCost",
  "leakStat",
  "startingLeakCost",
  "rankLeaks",
  "leakHistorySnapshot",
  "queuePriority",
  "emptyQueueState",
  "pickNext",
] as const;

/** The R0.11 skeleton placeholders S30 replaced with the functions above. */
const RETIRED_PLACEHOLDERS = [
  "GLICKO2_MODULE",
  "DIFFICULTY_MODULE",
  "FSRS_MODULE",
  "BKT_MODULE",
  "LEAK_COST_MODULE",
  "QUEUE_MODULE",
  "GRADING_MODULE",
] as const;

describe("@g-tee-oh/learning", () => {
  it("R0.1 learning stub builds and exports its name", () => {
    expect(PACKAGE_NAME).toBe("@g-tee-oh/learning");
  });

  it("R3.8 the grading module exports the policy functions in place of its placeholder", () => {
    const exported = learning as Record<string, unknown>;
    for (const name of S22_FUNCTIONS) {
      expect(typeof exported[name], name).toBe("function");
    }
  });

  it("R3.8 the retired R3.11 calibration and confident-miss exports are gone (O-345)", () => {
    const exported = learning as Record<string, unknown>;
    for (const name of ["isConfidentMiss", "aggregateCalibration", "promoteConfidentMiss", "recordAttempt"]) {
      expect(exported[name], name).toBeUndefined();
    }
  });

  it("R4.1 to R4.9 the learning core exports its functions and no skeleton placeholder remains (R0.11)", () => {
    const exported = learning as Record<string, unknown>;
    for (const name of S30_FUNCTIONS) {
      expect(typeof exported[name], name).toBe("function");
    }
    for (const name of RETIRED_PLACEHOLDERS) {
      expect(exported[name], name).toBeUndefined();
    }
  });
});
