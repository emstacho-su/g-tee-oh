import { describe, expect, it } from "vitest";

import * as learning from "../src/index.js";
import {
  BKT_MODULE,
  DIFFICULTY_MODULE,
  FSRS_MODULE,
  GLICKO2_MODULE,
  LEAK_COST_MODULE,
  PACKAGE_NAME,
  QUEUE_MODULE,
} from "../src/index.js";

/**
 * The A6 section 1 rows whose location is packages/learning and whose session has not landed, in
 * table order. The grading row left the list when S22 landed the policy (R3.8, R3.10, R3.11).
 */
const PENDING_A6_SECTION_1_LEARNING_ROWS = [
  GLICKO2_MODULE,
  DIFFICULTY_MODULE,
  FSRS_MODULE,
  BKT_MODULE,
  LEAK_COST_MODULE,
  QUEUE_MODULE,
];

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
  "isConfidentMiss",
  "aggregateCalibration",
  "promoteConfidentMiss",
] as const;

const SESSION_ID_PATTERN = /^S\d{2}$/;
const REQUIREMENT_ID_PATTERN = /^R\d\.\d+$/;

describe("@g-tee-oh/learning", () => {
  it("R0.1 learning stub builds and exports its name", () => {
    expect(PACKAGE_NAME).toBe("@g-tee-oh/learning");
  });

  it("R0.11 learning skeleton exports one placeholder per A6 section 1 row still owned by a later session", () => {
    expect(PENDING_A6_SECTION_1_LEARNING_ROWS.map((row) => row.module)).toEqual([
      "glicko2",
      "difficulty",
      "fsrs",
      "bkt",
      "leak-cost",
      "queue",
    ]);
    for (const row of PENDING_A6_SECTION_1_LEARNING_ROWS) {
      expect(row.session).toMatch(SESSION_ID_PATTERN);
      expect(row.requirements.length).toBeGreaterThan(0);
      expect(row.requirements.every((id) => REQUIREMENT_ID_PATTERN.test(id))).toBe(true);
      expect(Object.isFrozen(row)).toBe(true);
    }
  });

  it("R3.8 the grading module exports the policy functions in place of its placeholder", () => {
    const exported = learning as Record<string, unknown>;
    for (const name of S22_FUNCTIONS) {
      expect(typeof exported[name], name).toBe("function");
    }
    expect(exported.GRADING_MODULE).toBeUndefined();
  });
});
