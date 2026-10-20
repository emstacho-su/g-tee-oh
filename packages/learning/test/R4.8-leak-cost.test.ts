/**
 * R4.8 leak cost vectors (R0.11 red half; the green half is S30 on p4/learning, src/leak-cost.ts).
 *
 * Formula (06 section 6): leak_cost = frequency (spots per 1,000 hands) x miss rate (share of
 * decisions above the noise floor) x average EV (expected value) loss per miss in big blinds (bb),
 * giving bb lost per 1,000 hands. Frequency comes from the equilibrium reach prior (ADR 0013):
 * 1,000 x seat share (seat rotation) x reach probability of the line under equilibrium play. Miss
 * rate and EV per miss are shrunk toward the track average while a class has under 30 decisions.
 * All fixture numbers are toy values chosen for arithmetic that is easy to check by hand; nothing
 * here comes from any reference tool.
 */
import { describe, expect, it } from "vitest";

export const HANDS_PER_UNIT = 1000;

/** Classes with fewer decisions than this are shrunk toward the track average (06 section 6). */
export const LEAK_COST_SHRINKAGE_MIN_DECISIONS = 30;

export type ReachPriorRow = {
  spotClass: string;
  tableSize: number;
  seatShare: number;
  reachProbability: number;
  expectedPer1000: number;
};

/** Equilibrium reach prior rows (ADR 0013): expectedPer1000 = 1,000 x seatShare x reachProbability. */
export const REACH_PRIOR_ROWS: readonly ReachPriorRow[] = Object.freeze([
  {
    spotClass: "facing-open/BTN-vs-CO/100bb/online",
    tableSize: 6,
    seatShare: 1 / 6,
    reachProbability: 0.072,
    expectedPer1000: 12,
  },
  {
    spotClass: "facing-3bet/CO-vs-BTN/100bb/online",
    tableSize: 6,
    seatShare: 1 / 6,
    reachProbability: 0.0315,
    expectedPer1000: 5.25,
  },
  {
    spotClass: "facing-4bet/UTG-vs-BB/200bb/live",
    tableSize: 9,
    seatShare: 1 / 9,
    reachProbability: 0.018,
    expectedPer1000: 2,
  },
]);

/** The worked row: 12 x 0.25 x 1.5 = 4.5 bb per 1,000 hands. */
export const LEAK_COST_WORKED_ROW = Object.freeze({
  spotClass: "facing-open/BTN-vs-CO/100bb/online",
  frequencyPer1000: 12,
  decisions: 20,
  missesAboveFloor: 5,
  missRate: 0.25,
  evLossPerMissBb: 1.5,
  expectedLeakCostBbPer1000: 4.5,
});

/**
 * Shrinkage toward the track average under 30 decisions (06 section 6). The vault fixes the
 * threshold and the direction but not the weight; the bounds assertion holds for any weight rule,
 * and the proposed linear weight n / 30 gives the numbers in proposedLinearWeight.
 */
export const LEAK_COST_SHRINKAGE_FIXTURE = Object.freeze({
  classDecisions: 20,
  classMissRate: 0.25,
  classEvLossPerMissBb: 1.5,
  trackMissRate: 0.15,
  trackEvLossPerMissBb: 1,
  frequencyPer1000: 12,
  proposedLinearWeight: {
    weightOnClass: 20 / 30,
    missRate: 0.2166666667,
    evLossPerMissBb: 1.3333333333,
    leakCostBbPer1000: 3.4666666667,
  },
  unshrunkFromDecisions: LEAK_COST_SHRINKAGE_MIN_DECISIONS,
});

/** A frequent small leak outranks a rare large one (06 section 6). */
export const LEAK_COST_RANKING_FIXTURE = Object.freeze([
  {
    spotClass: "rfi/CO/100bb/online",
    frequencyPer1000: 40,
    missRate: 0.1,
    evLossPerMissBb: 0.5,
    expectedLeakCostBbPer1000: 2,
  },
  {
    spotClass: "facing-4bet/UTG-vs-BB/200bb/live",
    frequencyPer1000: 2,
    missRate: 0.5,
    evLossPerMissBb: 1.5,
    expectedLeakCostBbPer1000: 1.5,
  },
]);

describe("R4.8 leak cost from the equilibrium reach prior (S30, ADR 0013)", () => {
  it("R0.11 leak cost vector data parses and its arithmetic checks by hand", () => {
    for (const row of REACH_PRIOR_ROWS) {
      expect(HANDS_PER_UNIT * row.seatShare * row.reachProbability).toBeCloseTo(row.expectedPer1000, 9);
      expect(row.seatShare * row.tableSize).toBeCloseTo(1, 9);
    }
    const worked = LEAK_COST_WORKED_ROW;
    expect(worked.missesAboveFloor / worked.decisions).toBe(worked.missRate);
    expect(worked.frequencyPer1000 * worked.missRate * worked.evLossPerMissBb).toBe(
      worked.expectedLeakCostBbPer1000,
    );
    for (const row of LEAK_COST_RANKING_FIXTURE) {
      expect(row.frequencyPer1000 * row.missRate * row.evLossPerMissBb).toBeCloseTo(
        row.expectedLeakCostBbPer1000,
        9,
      );
    }
    expect(LEAK_COST_SHRINKAGE_FIXTURE.classDecisions).toBeLessThan(LEAK_COST_SHRINKAGE_MIN_DECISIONS);
  });

  it.todo(
    "R4.8 worked row: frequency 12 per 1,000 hands x miss rate 0.25 x 1.5 bb per miss gives 4.5 bb per 1,000 hands (06 section 6)",
  );
  it.todo(
    "R4.8 equilibrium reach prior: 1,000 x seat share x reach probability gives 12, 5.25 and 2 spots per 1,000 hands for the fixture lines (ADR 0013)",
  );
  it.todo("R4.8 miss rate counts only decisions above the noise floor: 5 misses in 20 decisions give 0.25");
  it.todo(
    "R4.8 shrinkage under 30 decisions: a class with 20 decisions lands strictly between its own miss rate 0.25 and the track average 0.15, and likewise for EV per miss between 1.5 and 1.0",
  );
  it.todo("R4.8 no shrinkage at 30 or more decisions: the class values are used unchanged");
  it.todo(
    "R4.8 proposed linear weight n / 30: 20 decisions give miss rate 0.2166666667, 1.3333333333 bb per miss and 3.4666666667 bb per 1,000 hands (S30 may replace the weight rule and this row together)",
  );
  it.todo(
    "R4.8 ranking: a frequent small leak (40 x 0.1 x 0.5 = 2.0) outranks a rare large one (2 x 0.5 x 1.5 = 1.5)",
  );
  it.todo("R4.8 a class with zero decisions takes the track average and raises no division by zero");
  it.todo("R4.8 the computation returns new objects and never mutates the leak_stat rows it reads");
});
