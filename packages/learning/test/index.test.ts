import { describe, expect, it } from "vitest";

import {
  BKT_MODULE,
  DIFFICULTY_MODULE,
  FSRS_MODULE,
  GLICKO2_MODULE,
  GRADING_MODULE,
  LEAK_COST_MODULE,
  PACKAGE_NAME,
  QUEUE_MODULE,
} from "../src/index.js";

/** The A6 section 1 rows whose location is packages/learning, in table order. */
const A6_SECTION_1_LEARNING_ROWS = [
  GRADING_MODULE,
  GLICKO2_MODULE,
  DIFFICULTY_MODULE,
  FSRS_MODULE,
  BKT_MODULE,
  LEAK_COST_MODULE,
  QUEUE_MODULE,
];

const SESSION_ID_PATTERN = /^S\d{2}$/;
const REQUIREMENT_ID_PATTERN = /^R\d\.\d+$/;

describe("@g-tee-oh/learning", () => {
  it("R0.1 learning stub builds and exports its name", () => {
    expect(PACKAGE_NAME).toBe("@g-tee-oh/learning");
  });

  it("R0.11 learning skeleton exports one placeholder per A6 section 1 row owned by this package", () => {
    expect(A6_SECTION_1_LEARNING_ROWS.map((row) => row.module)).toEqual([
      "grading",
      "glicko2",
      "difficulty",
      "fsrs",
      "bkt",
      "leak-cost",
      "queue",
    ]);
    for (const row of A6_SECTION_1_LEARNING_ROWS) {
      expect(row.session).toMatch(SESSION_ID_PATTERN);
      expect(row.requirements.length).toBeGreaterThan(0);
      expect(row.requirements.every((id) => REQUIREMENT_ID_PATTERN.test(id))).toBe(true);
      expect(Object.isFrozen(row)).toBe(true);
    }
  });
});
